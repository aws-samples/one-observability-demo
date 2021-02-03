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
import com.amazonaws.xray.entities.Subsegment;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.amazonaws.xray.AWSXRay;

import java.util.*;
import java.util.concurrent.TimeUnit;

@RestController
public class SearchController {
    public static final String BUCKET_NAME = "/petstore/s3bucketname";
    public static final String DYNAMODB_TABLENAME = "/petstore/dynamodbtablename";

    private final AmazonS3 s3Client;
    private final AmazonDynamoDB ddbClient;
    private final AWSSimpleSystemsManagement ssmClient;

    public SearchController(AmazonS3 s3Client, AmazonDynamoDB ddbClient, AWSSimpleSystemsManagement ssmClient) {
        this.s3Client = s3Client;
        this.ddbClient = ddbClient;
        this.ssmClient = ssmClient;
    }

    private String getKey(String petType, String petId) {

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


        Subsegment subsegment = AWSXRay.beginSubsegment("Get Pet URL");
        String urlString;

        try {

            String s3BucketName = getSSMParameter(BUCKET_NAME);

            String key = getKey(petType, image);

            int random = (int)Math.random() * 10;

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
            subsegment.addException(e);
            throw e;
        } catch (Exception e) {
            subsegment.addException(e);
            throw e;
        }

        return urlString;
    }

    private String getSSMParameter(String bucketName) {
        GetParameterRequest parameterRequest = new GetParameterRequest().withName(bucketName).withWithDecryption(false);

        GetParameterResult parameterResult = ssmClient.getParameter(parameterRequest);
        return parameterResult.getParameter().getValue();
    }

    private List<Pet> buildPets(List<Map<String, AttributeValue>> items) {

        List<Pet> result = new ArrayList<>();

        for (Map<String, AttributeValue> item : items) {

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

        return result;

    }


    @GetMapping("/api/search")
    public List<Pet> search(
            @RequestParam(name = "pettype", defaultValue = "", required = false) String petType,
            @RequestParam(name = "petcolor", defaultValue = "", required = false) String petColor,
            @RequestParam(name = "petid", defaultValue = "", required = false) String petId
    ) throws InterruptedException {

        Subsegment subsegment = AWSXRay.beginSubsegment("Scanning DynamoDB Table");
        try {

            String dynamoDBTableName = getSSMParameter(DYNAMODB_TABLENAME);

            ScanRequest scanRequest = new ScanRequest()
                    .withTableName(dynamoDBTableName);


            if (petType != null && !petType.trim().isEmpty()) {
                scanRequest.addScanFilterEntry("pettype",
                        new Condition()
                                .withComparisonOperator(ComparisonOperator.EQ)
                                .withAttributeValueList(new AttributeValue().withS(petType)));
            }

            if (petColor != null && !petColor.trim().isEmpty()) {
                scanRequest.addScanFilterEntry("petcolor",
                        new Condition()
                                .withComparisonOperator(ComparisonOperator.EQ)
                                .withAttributeValueList(new AttributeValue().withS(petColor)));
            }

            if (petId != null && !petId.trim().isEmpty()) {
                scanRequest.addScanFilterEntry("petid",
                        new Condition()
                                .withComparisonOperator(ComparisonOperator.EQ)
                                .withAttributeValueList(new AttributeValue().withS(petId)));
            }

            // This line is intentional. Delays searches
            if (petType != null && !petType.trim().isEmpty() && petType.equals("bunny")) {
                TimeUnit.MILLISECONDS.sleep(3000);
            }


            subsegment.putAnnotation("Query", String.format("petcolor:%s-pettype:%s-petid:%s", petColor, petType, petId));

            ScanResult result = ddbClient.scan(scanRequest);
            List<Map<String, AttributeValue>> resultItems = new ArrayList<>();

            for (Map<String, AttributeValue> item : result.getItems()) {
                resultItems.add(item);
            }
            try {
                AWSXRay.endSubsegment();
            } catch (Exception xxx) {
            }
            return buildPets(resultItems);

        } catch (Exception e) {
            subsegment.addException(e);
            throw e;
        } finally {
            AWSXRay.endSubsegment();
        }

    }

}
