package ca.petsearch.controllers;

import com.amazonaws.services.dynamodbv2.AmazonDynamoDB;
import com.amazonaws.services.dynamodbv2.model.AttributeValue;
import com.amazonaws.services.dynamodbv2.model.PutItemRequest;
import com.amazonaws.xray.AWSXRay;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.testcontainers.containers.localstack.LocalStackContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.testcontainers.containers.localstack.LocalStackContainer.Service.*;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(AWSTestConfig.class)
public class SearchControllerIT {

    private static final String BUCKET_NAME = "petsearch";
    public static final String DYNAMODB_TABLE = "petsearch";

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private AmazonDynamoDB dynamoDbClient;

    @Container
    static LocalStackContainer localStack = new LocalStackContainer("0.10.0")
            .withServices(S3, DYNAMODB, SSM)
            .withEnv("DEFAULT_REGION", "us-east-2");

    @BeforeAll
    static void beforeAll() throws IOException, InterruptedException {
        localStack.execInContainer("awslocal", "ssm", "put-parameter", "--name", "/petstore/s3bucketname", "--type", "String","--value", BUCKET_NAME);
        localStack.execInContainer("awslocal", "ssm", "put-parameter", "--name", "/petstore/dynamodbtablename", "--type", "String", "--value", DYNAMODB_TABLE);
        localStack.execInContainer("awslocal", "dynamodb", "create-table", "--table-name", DYNAMODB_TABLE,
                "--key-schema", "AttributeName=petid,KeyType=HASH",
                "--attribute-definitions", "AttributeName=petid,AttributeType=S AttributeName=availability,AttributeType=S",
                "--provisioned-throughput", "ReadCapacityUnits=5,WriteCapacityUnits=5");

        localStack.execInContainer("awslocal", "s3", "mb", "s3://" + BUCKET_NAME);

        AWSXRay.beginSegment("AmazonDynamoDBv2");

    }

    @BeforeEach
    public void before() {
        final String id = UUID.randomUUID().toString();
        final PutItemRequest putItemRequest = new PutItemRequest()
                .withTableName(DYNAMODB_TABLE)
                .withItem(
                        Map.of(
                                "petid", new AttributeValue().withS(id),
                                "pettype", new AttributeValue().withS("kitten"),
                                "petcolor", new AttributeValue().withS("braun"),
                                "availability", new AttributeValue().withS("now"),
                                "cuteness_rate", new AttributeValue().withS("high"),
                                "price", new AttributeValue().withS("500.00"),
                                "image", new AttributeValue().withS(id)
                        )
                );
        dynamoDbClient.putItem(putItemRequest);
    }


    @Test
    public void testSearchNoFilters() {
        assertThat(this.restTemplate.getForObject("http://localhost:" + port + "/api/search",
                String.class)).contains("petid", "availability", "now", "petcolor", "braun");
    }
}
