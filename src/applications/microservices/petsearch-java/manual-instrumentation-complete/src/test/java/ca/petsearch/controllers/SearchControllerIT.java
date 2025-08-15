/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package ca.petsearch.controllers;

import com.amazonaws.services.dynamodbv2.AmazonDynamoDB;
import com.amazonaws.services.dynamodbv2.AmazonDynamoDBClientBuilder;
import com.amazonaws.services.dynamodbv2.model.AttributeValue;
import com.amazonaws.services.dynamodbv2.model.PutItemRequest;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagement;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagementClientBuilder;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.testcontainers.containers.localstack.LocalStackContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.testcontainers.containers.localstack.LocalStackContainer.Service.*;

@Testcontainers
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Tag("integration")
@TestPropertySource(properties = {"AWS_REGION=us-east-2"})
public class SearchControllerIT {

    private static final String BUCKET_NAME = "petsearch";
    public static final String DYNAMODB_TABLE = "petsearch";

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private AmazonDynamoDB dynamoDbClient;

    private String kittenId;

    private String puppyId;

    private String bunnyId;

    @Container
    public static LocalStackContainer localStack = new LocalStackContainer("0.10.0")
            .withServices(S3, DYNAMODB, SSM)
            .withEnv("DEFAULT_REGION", "us-east-2");

    @BeforeAll
    static void beforeAll() throws IOException, InterruptedException {
        localStack.execInContainer("awslocal", "ssm", "put-parameter", "--name", "/petstore/s3bucketname", "--type", "String", "--value", BUCKET_NAME);
        localStack.execInContainer("awslocal", "ssm", "put-parameter", "--name", "/petstore/dynamodbtablename", "--type", "String", "--value", DYNAMODB_TABLE);
        localStack.execInContainer("awslocal", "dynamodb", "create-table", "--table-name", DYNAMODB_TABLE,
                "--key-schema", "AttributeName=petid,KeyType=HASH",
                "--attribute-definitions", "AttributeName=petid,AttributeType=S AttributeName=availability,AttributeType=S",
                "--provisioned-throughput", "ReadCapacityUnits=5,WriteCapacityUnits=5");

        localStack.execInContainer("awslocal", "s3", "mb", "s3://" + BUCKET_NAME);
    }

    @BeforeEach
    public void addPets() {
        if (kittenId == null) {
            kittenId = putPet(new HashMap<>(Map.of(
                    "pettype", new AttributeValue().withS("kitten"),
                    "petcolor", new AttributeValue().withS("braun"),
                    "availability", new AttributeValue().withS("now"),
                    "cuteness_rate", new AttributeValue().withS("high"),
                    "price", new AttributeValue().withS("500.00")
            )));
        }
        if (bunnyId == null) {
            bunnyId = putPet(new HashMap<>(Map.of(
                    "pettype", new AttributeValue().withS("bunny"),
                    "petcolor", new AttributeValue().withS("black"),
                    "availability", new AttributeValue().withS("now"),
                    "cuteness_rate", new AttributeValue().withS("high"),
                    "price", new AttributeValue().withS("150.00")
            )));
        }
        if (puppyId == null) {
            puppyId = putPet(new HashMap<>(Map.of(
                    "pettype", new AttributeValue().withS("puppy"),
                    "petcolor", new AttributeValue().withS("white"),
                    "availability", new AttributeValue().withS("now"),
                    "cuteness_rate", new AttributeValue().withS("high"),
                    "price", new AttributeValue().withS("350.00")
            )));
        }
    }

    private String putPet(Map<String, AttributeValue> petData) {
        final String id = UUID.randomUUID().toString();
        petData.put("petid", new AttributeValue().withS(id));
        petData.put("image", new AttributeValue().withS(id));
        final PutItemRequest putItemRequest = new PutItemRequest()
                .withTableName(DYNAMODB_TABLE)
                .withItem(
                        petData
                );
        dynamoDbClient.putItem(putItemRequest);
        return id;
    }


    @Test
    public void testSearchNoFilters() {
        assertThat(this.restTemplate.getForObject("http://localhost:" + port + "/api/search",
                String.class))
                .contains("petid", "availability", "petcolor", "peturl", kittenId, bunnyId, puppyId)
                .doesNotContain("{S:")
        ;
    }

    @Test
    public void testSearchByPetType() {
        assertThat(this.restTemplate.getForObject("http://localhost:" + port + "/api/search?pettype=bunny",
                String.class))
                .contains("petid", "availability", "petcolor", "peturl", bunnyId)
                .doesNotContain(kittenId, puppyId);

        assertThat(this.restTemplate.getForObject("http://localhost:" + port + "/api/search?pettype=puppy",
                String.class))
                .contains("petid", "availability", "petcolor", "peturl", puppyId)
                .doesNotContain(kittenId, bunnyId);

        assertThat(this.restTemplate.getForObject("http://localhost:" + port + "/api/search?pettype=kitten",
                String.class))
                .contains("petid", "availability", "petcolor", "peturl", kittenId)
                .doesNotContain(puppyId, bunnyId);
    }

    @Test
    public void testSearchByPetColor() {
        assertThat(this.restTemplate.getForObject("http://localhost:" + port + "/api/search?petcolor=braun",
                String.class))
                .contains("petid", "availability", "petcolor", "peturl", kittenId)
                .doesNotContain(bunnyId, puppyId);

        assertThat(this.restTemplate.getForObject("http://localhost:" + port + "/api/search?petcolor=black",
                String.class))
                .contains("petid", "availability", "petcolor", "peturl", bunnyId)
                .doesNotContain(kittenId, puppyId);

        assertThat(this.restTemplate.getForObject("http://localhost:" + port + "/api/search?petcolor=white",
                String.class))
                .contains("petid", "availability", "petcolor", "peturl", puppyId)
                .doesNotContain(kittenId, bunnyId);
    }

    @Test
    public void testSearchByPetId() {
        assertThat(this.restTemplate.getForObject("http://localhost:" + port + "/api/search?petid=" + kittenId,
                String.class))
                .contains("petid", "availability", "petcolor", "peturl", kittenId)
                .doesNotContain(bunnyId, puppyId);

        assertThat(this.restTemplate.getForObject("http://localhost:" + port + "/api/search?petid=" + bunnyId,
                String.class))
                .contains("petid", "availability", "petcolor", "peturl", bunnyId)
                .doesNotContain(kittenId, puppyId);

        assertThat(this.restTemplate.getForObject("http://localhost:" + port + "/api/search?petid=" + puppyId,
                String.class))
                .contains("petid", "availability", "petcolor", "peturl", puppyId)
                .doesNotContain(kittenId, bunnyId);
    }

    @TestConfiguration
    static class AWSTestConfig {

        @Bean
        @Primary
        public AmazonS3 amazonS3() {
            return AmazonS3ClientBuilder.standard()
                    .withCredentials(localStack.getDefaultCredentialsProvider())
                    .withEndpointConfiguration(localStack.getEndpointConfiguration(S3))
                    .build();
        }

        @Bean
        @Primary
        public AmazonDynamoDB amazonDynamoDB() {
            return AmazonDynamoDBClientBuilder.standard()
                    .withCredentials(localStack.getDefaultCredentialsProvider())
                    .withEndpointConfiguration(localStack.getEndpointConfiguration(DYNAMODB))
                    .build();
        }

        @Bean
        @Primary
        public AWSSimpleSystemsManagement awsSimpleSystemsManagement() {
            return AWSSimpleSystemsManagementClientBuilder.standard()
                    .withCredentials(localStack.getDefaultCredentialsProvider())
                    .withEndpointConfiguration(localStack.getEndpointConfiguration(SSM))
                    .build();
        }

    }
}
