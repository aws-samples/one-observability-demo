package ca.petsearch.controllers;

import com.amazonaws.HttpMethod;
import com.amazonaws.regions.Regions;
import com.amazonaws.services.dynamodbv2.AmazonDynamoDB;
import com.amazonaws.services.dynamodbv2.AmazonDynamoDBClientBuilder;
import com.amazonaws.services.dynamodbv2.model.AttributeValue;
import com.amazonaws.services.dynamodbv2.model.ScanRequest;
import com.amazonaws.services.dynamodbv2.model.ScanResult;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import com.amazonaws.services.s3.model.AmazonS3Exception;
import com.amazonaws.services.s3.model.GeneratePresignedUrlRequest;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagement;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagementClientBuilder;
import com.amazonaws.services.simplesystemsmanagement.model.GetParameterRequest;
import com.amazonaws.services.simplesystemsmanagement.model.GetParameterResult;
import com.amazonaws.xray.handlers.TracingHandler;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor;
import io.opentelemetry.exporters.otlp.OtlpGrpcSpanExporter;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.amazonaws.xray.AWSXRay;
import com.amazonaws.xray.entities.Subsegment;

import java.util.*;
import java.util.concurrent.TimeUnit;

@RestController
public class SearchController {

    private static AmazonDynamoDB ddbClient;
    private static AmazonS3 s3Client;
    private static AWSSimpleSystemsManagement ssmClient;
    private static Subsegment subsegment;

    static {

        ddbClient = AmazonDynamoDBClientBuilder.standard().withRegion(Regions.US_WEST_2).build();
        s3Client = AmazonS3ClientBuilder
                .standard()
                .withRegion(Regions.US_WEST_2)
                .withForceGlobalBucketAccessEnabled(true)
                .withRequestHandlers(new TracingHandler(AWSXRay.getGlobalRecorder()))
                .build();
        ssmClient = AWSSimpleSystemsManagementClientBuilder.standard().withRegion(Regions.US_WEST_2).build();

        OpenTelemetrySdk.getTracerProvider()
                .addSpanProcessor(BatchSpanProcessor.newBuilder(
                        OtlpGrpcSpanExporter.newBuilder()
                                .readSystemProperties()
                                .readEnvironmentVariables()
                                .build())
                        .build());

        // System.setProperty(SDKGlobalConfiguration.ENABLE_S3_SIGV4_SYSTEM_PROPERTY, "true");
    }

    private String getKey(String petType, String petId){

        String folderName;

        switch(petType){
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

    private String getPetUrl(String petType, String image){

        String urlString;

        try{

            GetParameterRequest parameterRequest = new GetParameterRequest().withName("s3bucketname").withWithDecryption(false);
            GetParameterResult parameterResult = ssmClient.getParameter(parameterRequest);
            String s3BucketName = parameterResult.getParameter().getValue();

            String key = getKey(petType, image);

            GeneratePresignedUrlRequest generatePresignedUrlRequest =
                    new GeneratePresignedUrlRequest(s3BucketName, key)
                            .withMethod(HttpMethod.GET)
                            .withExpiration(new Date(System.currentTimeMillis() + TimeUnit.MINUTES.toMillis(5)));

            urlString = s3Client.generatePresignedUrl(generatePresignedUrlRequest).toString();

        } catch (AmazonS3Exception e){
            subsegment.addException(e);
            throw e;
        } catch (Exception e){
            subsegment.addException(e);
            throw e;
        }

        return urlString;
    }

    private List<Pet> buildPets(List<Map<String, AttributeValue>> items){

        List<Pet> result = new ArrayList<>();

        for(Map<String, AttributeValue> item: items){

            String petId = item.get("petid").toString();
            String availability = item.get("availability").toString();
            String cutenessRate = item.get("cuteness_rate").toString();
            String petColor = item.get("petcolor").toString();
            String petType = item.get("pettype").toString();
            String price = item.get("price").toString();
            String petUrl = getPetUrl(petType, item.get("image").toString());

            Pet currentPet = new Pet(petId, availability, cutenessRate, petColor, petType, price, petUrl);

            result.add(currentPet);

        }

        AWSXRay.getCurrentSubsegment().putMetadata("Pets", result);

        // System.out.println(AWSXRay.getCurrentSubsegment().getTraceId());

        return result;

    }

    @GetMapping("/api/search")
    public List<Pet> search(
            @RequestParam(name="pettype", defaultValue="", required = false) String petType,
            @RequestParam(name="petcolor", defaultValue="", required = false) String petColor,
            @RequestParam(name="petid", defaultValue="", required = false) String petId
    ) throws InterruptedException {

        subsegment = AWSXRay.beginSubsegment("Scanning DynamoDB Table");

        try {

            GetParameterRequest parameterRequest = new GetParameterRequest().withName("dynamodbtablename").withWithDecryption(false);
            GetParameterResult parameterResult = ssmClient.getParameter(parameterRequest);
            String dynamoDBTableName = parameterResult.getParameter().getValue();

            Map<String, AttributeValue> expressionAttributeValues = new HashMap<>();

            if(petType != null && !petType.trim().isEmpty()){
                expressionAttributeValues.put(":pettype", new AttributeValue().withS(petType));
            }
            if(petColor != null && !petColor.trim().isEmpty()){
                expressionAttributeValues.put(":petcolor", new AttributeValue().withS(petColor));
            }
            if(petId != null && !petId.trim().isEmpty()) {
                expressionAttributeValues.put(":petid", new AttributeValue().withS(petId));
            }

            ScanRequest scanRequest = new ScanRequest()
                    .withTableName(dynamoDBTableName)
                    .withExpressionAttributeValues(expressionAttributeValues);

            if(petType != null && !petType.trim().isEmpty() && petType.equals("bunny")){
                TimeUnit.MILLISECONDS.sleep(3000);
            }

            AWSXRay.getCurrentSubsegment()
                    .putAnnotation("Query", String.format("petcolor:%s-pettype:%s-petid:%s", petColor, petType, petId));

            // System.out.println(AWSXRay.getCurrentSubsegment().getTraceId());

            ScanResult result = ddbClient.scan(scanRequest);
            List<Map<String, AttributeValue>> resultItems = new ArrayList<>();

            for (Map<String, AttributeValue> item : result.getItems()){
                resultItems.add(item);
            }

            AWSXRay.endSubsegment();
            return buildPets(resultItems);

        } catch(Exception e) {
            subsegment.addException(e);
            throw e;
        } finally {
            AWSXRay.endSubsegment();
        }

    }

}
