/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package ca.petsearch.controllers;

import ca.petsearch.MetricEmitter;
import ca.petsearch.ParameterRefreshManager;
import ca.petsearch.RandomNumberGenerator;
import com.amazonaws.HttpMethod;
import com.amazonaws.services.dynamodbv2.AmazonDynamoDB;
import com.amazonaws.services.dynamodbv2.model.AttributeValue;
import com.amazonaws.services.dynamodbv2.model.ComparisonOperator;
import com.amazonaws.services.dynamodbv2.model.Condition;
import com.amazonaws.services.dynamodbv2.model.ScanRequest;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.GeneratePresignedUrlRequest;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagement;
import com.amazonaws.services.simplesystemsmanagement.model.GetParameterRequest;
import com.amazonaws.services.simplesystemsmanagement.model.GetParameterResult;
import com.amazonaws.services.simplesystemsmanagement.model.ParameterNotFoundException;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;
import io.opentelemetry.instrumentation.annotations.WithSpan;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

@RestController
public class SearchController {
    private final RandomNumberGenerator randomGenerator;

    // Configurable parameter names via environment variables
    private final String imagesCdnUrlParam;
    private final String s3BucketParam;
    private final String dynamodbTableParam;

    private Logger logger = LoggerFactory.getLogger(SearchController.class);

    private final AmazonS3 s3Client;
    private final AmazonDynamoDB ddbClient;
    private final AWSSimpleSystemsManagement ssmClient;
    private final MetricEmitter metricEmitter;
    private final Tracer tracer;
    private final ParameterRefreshManager refreshManager;

    public SearchController(AmazonS3 s3Client, AmazonDynamoDB ddbClient, AWSSimpleSystemsManagement ssmClient,
            MetricEmitter metricEmitter, Tracer tracer, RandomNumberGenerator randomGenerator,
            ParameterRefreshManager refreshManager) {
        this.s3Client = s3Client;
        this.ddbClient = ddbClient;
        this.ssmClient = ssmClient;
        this.metricEmitter = metricEmitter;
        this.tracer = tracer;
        this.randomGenerator = randomGenerator;
        this.refreshManager = refreshManager;

        // Initialize configurable parameter names from environment variables
        String paramPrefix = getRequiredEnvironmentVariable("PETSEARCH_PARAM_PREFIX");
        String s3BucketName = getRequiredEnvironmentVariable("PETSEARCH_S3_BUCKET_NAME");
        String dynamodbTableName = getRequiredEnvironmentVariable("PETSEARCH_DYNAMODB_TABLE_NAME");
        String imagesCdnUrl = getRequiredEnvironmentVariable("PETSEARCH_IMAGES_CDN_URL");

        this.imagesCdnUrlParam = paramPrefix + "/" + imagesCdnUrl;
        this.s3BucketParam = paramPrefix + "/" + s3BucketName;
        this.dynamodbTableParam = paramPrefix + "/" + dynamodbTableName;

        logger.info("Using SSM parameter names: ImagesCDN={}, S3Bucket={}, DynamoDBTable={}",
                   imagesCdnUrlParam, s3BucketParam, dynamodbTableParam);
    }

    /**
     * Get a required environment variable, throwing an exception if it's missing or empty
     */
    private String getRequiredEnvironmentVariable(String name) {
        String value = System.getenv(name);
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalStateException("Required environment variable '" + name + "' is not set or is empty");
        }
        return value.trim();
    }

    private String getKey(String petType, String petId) {
        logger.debug("Generating S3 key for petType: '{}', petId: '{}'", petType, petId);

        String folderName;

        switch (petType) {
            case "bunny":
                folderName = "bunnies";
                break;
            case "puppy":
                folderName = "puppies";
                break;
            default:
                folderName = "kittens";
                break;
        }

        String key = String.format("%s/%s.jpg", folderName, petId);
        logger.debug("Generated S3 key '{}' for petType '{}', petId '{}'", key, petType, petId);
        return key;
    }

    private String getPetUrl(String petType, String image) {
        Span span = tracer.spanBuilder("Get Pet URL").startSpan();

        try (Scope scope = span.makeCurrent()) {
            logger.debug("Building pet URL for petType: '{}', image: '{}'", petType, image);

            // CloudFront now serves the images directly - no need for pre-signed URLs
            String imagesCdnUrl = getSSMParameter(imagesCdnUrlParam);
            String key = getKey(petType, image);

            String cloudFrontUrl = String.format("%s/%s", imagesCdnUrl, key);
            logger.info("Generated CloudFront URL for petType '{}', image '{}': {}", petType, image, cloudFrontUrl);

            span.setAttribute("pet.url.petType", petType);
            span.setAttribute("pet.url.image", image);
            span.setAttribute("pet.url.key", key);
            span.setAttribute("pet.url.cloudFrontUrl", cloudFrontUrl);

            return cloudFrontUrl;

        } catch (Exception e) {
            logger.error("Error while building CloudFront URL for petType '{}', image '{}'", petType, image, e);
            span.recordException(e);
            span.setAttribute("error.petType", petType);
            span.setAttribute("error.image", image);
            throw (e);
        } finally {
            span.end();
        }
    }

    @WithSpan("Get parameter from Systems Manager or cache") // this annotation can be used as an alternative to
                                                             // tracer.spanBuilder
    private String getSSMParameter(String paramName) {
        logger.info("Attempting to retrieve SSM parameter: {}", paramName);

        if (refreshManager.shouldRefresh(paramName)) {
            try {
                logger.debug("Parameter needs refresh, fetching from SSM: {}", paramName);

                GetParameterRequest parameterRequest = new GetParameterRequest().withName(paramName)
                        .withWithDecryption(false);

                GetParameterResult parameterResult = ssmClient.getParameter(parameterRequest);
                String paramValue = parameterResult.getParameter().getValue();

                logger.info("Successfully retrieved SSM parameter '{}' with value: {}", paramName,
                           paramValue != null ? paramValue.substring(0, Math.min(50, paramValue.length())) + "..." : "null");

                refreshManager.cacheParameter(paramName, paramValue);
                return paramValue;

            } catch (ParameterNotFoundException e) {
                logger.error("SSM Parameter NOT FOUND: '{}'. This parameter does not exist in Parameter Store.", paramName);
                logger.error("Available environment variables for debugging:");
                System.getenv().entrySet().stream()
                    .filter(entry -> entry.getKey().startsWith("PETSEARCH_"))
                    .forEach(entry -> logger.error("  {} = {}", entry.getKey(), entry.getValue()));

                // Add span attributes for better tracing
                Span currentSpan = Span.current();
                currentSpan.setAttribute("error", true);
                currentSpan.setAttribute("error.parameter_name", paramName);
                currentSpan.setAttribute("error.type", "ParameterNotFoundException");
                currentSpan.recordException(e);

                throw new RuntimeException("Failed to retrieve SSM parameter: " + paramName +
                                         ". Parameter does not exist in Parameter Store.", e);

            } catch (Exception e) {
                logger.error("Unexpected error retrieving SSM parameter '{}': {}", paramName, e.getMessage(), e);

                // Add span attributes for better tracing
                Span currentSpan = Span.current();
                currentSpan.setAttribute("error", true);
                currentSpan.setAttribute("error.parameter_name", paramName);
                currentSpan.setAttribute("error.type", e.getClass().getSimpleName());
                currentSpan.recordException(e);

                throw new RuntimeException("Failed to retrieve SSM parameter: " + paramName, e);
            }
        } else {
            logger.debug("Using cached value for SSM parameter: {}", paramName);
            return refreshManager.getCachedParameter(paramName);
        }
    }

    private Pet mapToPet(Map<String, AttributeValue> item) {
        String petId = item.get("petid").getS();
        String availability = item.get("availability").getS();
        String cutenessRate = item.get("cuteness_rate").getS();
        String petColor = item.get("petcolor").getS();
        String petType = item.get("pettype").getS();
        String price = item.get("price").getS();
        String petUrl = getPetUrl(petType, item.get("image").getS());

        logger.debug("Mapping DynamoDB item to Pet object - petId: '{}', petType: '{}', petColor: '{}', availability: '{}', cutenessRate: '{}', price: '{}'",
                    petId, petType, petColor, availability, cutenessRate, price);

        Pet currentPet = new Pet(petId, availability, cutenessRate, petColor, petType, price, petUrl);
        return currentPet;
    }

    /**
     * Create SearchQuery object with parameter alias resolution
     * Similar to petfood Rust application's serde alias handling
     */
    private SearchQuery createSearchQuery(String petType, String petTypeAlias,
                                        String petColor, String petColorAlias,
                                        String petId, String petIdAlias) {
        // Resolve parameter aliases - primary names take precedence over aliases
        String resolvedPetType = !SearchQuery.isEmptyParameter(petType) ? petType : petTypeAlias;
        String resolvedPetColor = !SearchQuery.isEmptyParameter(petColor) ? petColor : petColorAlias;
        String resolvedPetId = !SearchQuery.isEmptyParameter(petId) ? petId : petIdAlias;

        return new SearchQuery(resolvedPetType, resolvedPetColor, resolvedPetId);
    }

    @GetMapping("/api/search")
    public ResponseEntity<?> search(
            @RequestParam(name = "pettype", defaultValue = "", required = false) String petType,
            @RequestParam(name = "pet_type", defaultValue = "", required = false) String petTypeAlias,
            @RequestParam(name = "petcolor", defaultValue = "", required = false) String petColor,
            @RequestParam(name = "pet_color", defaultValue = "", required = false) String petColorAlias,
            @RequestParam(name = "petid", defaultValue = "", required = false) String petId,
            @RequestParam(name = "pet_id", defaultValue = "", required = false) String petIdAlias,
            @RequestParam(name = "userId", defaultValue = "", required = false) String userId,
            @RequestParam(name = "user_id", defaultValue = "", required = false) String userIdAlias)
            throws InterruptedException {

        // Resolve userId parameter (primary takes precedence over alias)
        String resolvedUserId = !SearchQuery.isEmptyParameter(userId) ? userId : userIdAlias;

        // Log all input parameters for comprehensive tracing
        logger.info("Search request received - userId: '{}', petType: '{}', petTypeAlias: '{}', petColor: '{}', petColorAlias: '{}', petId: '{}', petIdAlias: '{}', userIdAlias: '{}'",
                   resolvedUserId, petType, petTypeAlias, petColor, petColorAlias, petId, petIdAlias, userIdAlias);
        logger.info("Search parameters resolved - userId: '{}', resolved petType: '{}', resolved petColor: '{}', resolved petId: '{}'",
                   resolvedUserId, petType, petColor, petId);

        // Create SearchQuery object with parameter resolution (similar to petfood Rust serde aliases)
        SearchQuery query = createSearchQuery(petType, petTypeAlias, petColor, petColorAlias, petId, petIdAlias);

        Span span = tracer.spanBuilder("Scanning DynamoDB Table").startSpan();

        // Use validated parameters from SearchQuery
        String validatedPetType = query.getValidatedPetType();
        String normalizedPetColor = query.getNormalizedPetColor();
        String normalizedPetId = query.getNormalizedPetId();

        // Log validated search parameters
        logger.info("Search query validated - userId: '{}', validatedPetType: '{}', normalizedPetColor: '{}', normalizedPetId: '{}'",
                   resolvedUserId, validatedPetType, normalizedPetColor, normalizedPetId);

        // return 404 error with custom message for invalid pet type
        if (!SearchQuery.isEmptyParameter(validatedPetType) &&
            !validatedPetType.equals("puppy") && !validatedPetType.equals("kitten") && !validatedPetType.equals("bunny")) {
            logger.warn("Invalid pet type requested by userId '{}' - petType: '{}', returning 404 error", resolvedUserId, validatedPetType);
            span.setAttribute("error", true);
            span.setAttribute("error.userId", resolvedUserId);
            String errorMsg = validatedPetType + " pet type not found";
            span.setAttribute("error.message", errorMsg);
            span.end();
            ErrorResponse errorResponse = new ErrorResponse(
                    404,
                    errorMsg,
                    errorMsg,
                    "/api/search");
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(errorResponse);
        }

        // This line is intentional. Delays searches
        if (!SearchQuery.isEmptyParameter(validatedPetType) && validatedPetType.equals("bunny")) {
            logger.info("Intentional delay triggered for userId '{}' searching for bunny pets", resolvedUserId);
            logger.debug("Delaying the response on purpose, to show on traces as an issue - userId: '{}'", resolvedUserId);
            TimeUnit.MILLISECONDS.sleep(3000);
            logger.info("Delay completed for userId '{}' bunny search", resolvedUserId);
        }

        try (Scope scope = span.makeCurrent()) {
            // Log the resolved parameters for tracing
            span.setAttribute("search.pettype", validatedPetType);
            span.setAttribute("search.petcolor", normalizedPetColor);
            span.setAttribute("search.petid", normalizedPetId);
            span.setAttribute("search.userid", resolvedUserId);

            // Log all input parameters for comprehensive tracing
            span.setAttribute("search.input.pettype", petType);
            span.setAttribute("search.input.pettype_alias", petTypeAlias);
            span.setAttribute("search.input.petcolor", petColor);
            span.setAttribute("search.input.petcolor_alias", petColorAlias);
            span.setAttribute("search.input.petid", petId);
            span.setAttribute("search.input.petid_alias", petIdAlias);
            span.setAttribute("search.input.userid", userId);
            span.setAttribute("search.input.userid_alias", userIdAlias);

            logger.info("Starting DynamoDB scan for userId '{}' with parameters - petType: '{}', petColor: '{}', petId: '{}'",
                       resolvedUserId, validatedPetType, normalizedPetColor, normalizedPetId);

            List<Pet> result = ddbClient.scan(
                    buildScanRequest(validatedPetType, normalizedPetColor, normalizedPetId))
                    .getItems().stream().map(this::mapToPet)
                    .collect(Collectors.toList());

            logger.info("DynamoDB scan completed for userId '{}' - found {} pets matching criteria", resolvedUserId, result.size());

            // Log details of each pet found
            for (int i = 0; i < result.size(); i++) {
                Pet pet = result.get(i);
                logger.info("Pet {} for userId '{}': petId='{}', petType='{}', petColor='{}', availability='{}', cutenessRate='{}', price='{}'",
                           i+1, resolvedUserId, pet.getPetid(), pet.getPettype(), pet.getPetcolor(),
                           pet.getAvailability(), pet.getCuteness_rate(), pet.getPrice());
            }

            metricEmitter.emitPetsReturnedMetric(result.size());
            logger.info("Search completed successfully for userId '{}' - returning {} pets", resolvedUserId, result.size());
            return ResponseEntity.ok(result);

        } catch (Exception e) {
            span.recordException(e);
            span.setAttribute("error.userId", resolvedUserId);
            logger.error("Error while searching for userId '{}' with parameters - petType: '{}', petColor: '{}', petId: '{}'",
                        resolvedUserId, validatedPetType, normalizedPetColor, normalizedPetId, e);
            throw e;
        } finally {
            span.end();
        }
    }

    private ScanRequest buildScanRequest(String petType, String petColor, String petId) {
        return Map.of("pettype", petType,
                "petcolor", petColor,
                "petid", petId).entrySet().stream()
                .filter(e -> !isEmptyParameter(e))
                .map(this::entryToCondition)
                .reduce(emptyScanRequest(), this::addScanFilter, this::joinScanResult);
    }

    private ScanRequest addScanFilter(ScanRequest scanResult, Map.Entry<String, Condition> element) {
        return scanResult.addScanFilterEntry(element.getKey(), element.getValue());
    }

    private ScanRequest emptyScanRequest() {
        return new ScanRequest().withTableName(getSSMParameter(dynamodbTableParam));
    }

    private ScanRequest joinScanResult(ScanRequest scanRequest1, ScanRequest scanRequest2) {
        Map<String, Condition> merged = new HashMap<>();
        merged.putAll(scanRequest1.getScanFilter() != null ? scanRequest1.getScanFilter() : Collections.emptyMap());
        merged.putAll(scanRequest2.getScanFilter() != null ? scanRequest2.getScanFilter() : Collections.emptyMap());

        return scanRequest1.withScanFilter(merged);
    }

    private Map.Entry<String, Condition> entryToCondition(Map.Entry<String, String> e) {
        Span.current().setAttribute(e.getKey(), e.getValue());
        return Map.entry(e.getKey(), new Condition()
                .withComparisonOperator(ComparisonOperator.EQ)
                .withAttributeValueList(new AttributeValue().withS(e.getValue())));
    }

    private boolean isEmptyParameter(Map.Entry<String, String> e) {
        return e.getValue() == null || e.getValue().isEmpty();
    }

}
