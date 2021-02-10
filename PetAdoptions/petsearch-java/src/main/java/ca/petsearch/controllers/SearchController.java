package ca.petsearch.controllers;

import com.amazonaws.HttpMethod;
import com.amazonaws.services.dynamodbv2.AmazonDynamoDB;
import com.amazonaws.services.dynamodbv2.model.*;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.AmazonS3Exception;
import com.amazonaws.services.s3.model.GeneratePresignedUrlRequest;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagement;
import com.amazonaws.services.simplesystemsmanagement.model.GetParameterRequest;
import com.amazonaws.services.simplesystemsmanagement.model.GetParameterResult;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

@RestController
public class SearchController {
    public static final String BUCKET_NAME = "/petstore/s3bucketname";
    public static final String DYNAMODB_TABLENAME = "/petstore/dynamodbtablename";

    private final AmazonS3 s3Client;
    private final AmazonDynamoDB ddbClient;
    private final AWSSimpleSystemsManagement ssmClient;
    private Map<String, String> paramCache = new HashMap<>();

    public SearchController(AmazonS3 s3Client, AmazonDynamoDB ddbClient, AWSSimpleSystemsManagement ssmClient) {
        this.s3Client = s3Client;
        this.ddbClient = ddbClient;
        this.ssmClient = ssmClient;
    }

    private String getKey(String petType, String petId) throws InterruptedException {

        String folderName;

        switch (petType) {
            case "bunny":
                folderName = "bunnies";
                break;
            case "puppy":
                folderName = "puppies";
                break;
            default:
                folderName = "kitten";
                break;
        }

        return String.format("%s/%s.jpg", folderName, petId);

    }

    private String getPetUrl(String petType, String image) {


        //Subsegment subsegment = AWSXRay.beginSubsegment("Get Pet URL");
        String urlString;

        try {

            String s3BucketName = getSSMParameter(BUCKET_NAME);

            String key = getKey(petType, image);

            int random = (int) Math.random() * 10;

            if (random == 4) {
                // Forced exception to show S3 bucket creation error. The bucket never really gets created due to lack of permissions
                s3Client.createBucket(s3BucketName);
            }

            GeneratePresignedUrlRequest generatePresignedUrlRequest =
                    new GeneratePresignedUrlRequest(s3BucketName, key)
                            .withMethod(HttpMethod.GET)
                            .withExpiration(new Date(System.currentTimeMillis() + TimeUnit.MINUTES.toMillis(5)));

            urlString = s3Client.generatePresignedUrl(generatePresignedUrlRequest).toString();

        } catch (AmazonS3Exception e) {
            //subsegment.addException(e);
            throw e;
        } catch (Throwable e) {
            //subsegment.addException(e);
            throw new RuntimeException(e);
        }

        return urlString;
    }

    private String getSSMParameter(String paramName) {
        if (!paramCache.containsKey(paramName)) {
            GetParameterRequest parameterRequest = new GetParameterRequest().withName(paramName).withWithDecryption(false);

            GetParameterResult parameterResult = ssmClient.getParameter(parameterRequest);
            paramCache.put(paramName, parameterResult.getParameter().getValue());
        }
        return paramCache.get(paramName);
    }

    private Pet mapToPet(Map<String, AttributeValue> item) {
        String petId = item.get("petid").getS();
        String availability = item.get("availability").getS();
        String cutenessRate = item.get("cuteness_rate").getS();
        String petColor = item.get("petcolor").getS();
        String petType = item.get("pettype").getS();
        String price = item.get("price").getS();
        String petUrl = getPetUrl(petType, item.get("image").getS());

        Pet currentPet = new Pet(petId, availability, cutenessRate, petColor, petType, price, petUrl);
        return currentPet;
    }


    @GetMapping("/api/search")
    public List<Pet> search(
            @RequestParam(name = "pettype", defaultValue = "", required = false) String petType,
            @RequestParam(name = "petcolor", defaultValue = "", required = false) String petColor,
            @RequestParam(name = "petid", defaultValue = "", required = false) String petId
    ) throws InterruptedException {

        //Subsegment subsegment = AWSXRay.beginSubsegment("Scanning DynamoDB Table");

        // This line is intentional. Delays searches
        if (petType != null && !petType.trim().isEmpty() && petType.equals("bunny")) {
            TimeUnit.MILLISECONDS.sleep(3000);
        }
        try {

            return ddbClient.scan(
                    Map.of("pettype", petType,
                            "petcolor", petColor,
                            "petid", petId).entrySet().stream()
                            .filter(e -> !isEmptyParameter(e))
                            .map(this::entryToCondition)
                            .reduce(emptyScanRequest(), this::addScanFilter, this::joinScanResult))
                    .getItems().stream().map(this::mapToPet)
                    .collect(Collectors.toList());

        } catch (Exception e) {
            //subsegment.addException(e);
            throw e;
        } finally {
            //AWSXRay.endSubsegment();
        }

    }

    private ScanRequest addScanFilter(ScanRequest scanResult, Map.Entry<String, Condition> element) {
        return scanResult.addScanFilterEntry(element.getKey(), element.getValue());
    }

    private ScanRequest emptyScanRequest() {
        return new ScanRequest().withTableName(getSSMParameter(DYNAMODB_TABLENAME));
    }

    private ScanRequest joinScanResult(ScanRequest scanRequest1, ScanRequest scanRequest2) {
        Map<String, Condition> merged = new HashMap<>();
        merged.putAll(scanRequest1.getScanFilter() != null ? scanRequest1.getScanFilter() : Collections.emptyMap());
        merged.putAll(scanRequest2.getScanFilter() != null ? scanRequest2.getScanFilter() : Collections.emptyMap());

        return scanRequest1.withScanFilter(merged);
    }

    private Map.Entry<String, Condition> entryToCondition(Map.Entry<String, String> e) {
        return Map.entry(e.getKey(), new Condition()
                .withComparisonOperator(ComparisonOperator.EQ)
                .withAttributeValueList(new AttributeValue().withS(e.getValue())));
    }

    private boolean isEmptyParameter(Map.Entry<String, String> e) {
        return e.getValue() == null || e.getValue().isEmpty();
    }

}
