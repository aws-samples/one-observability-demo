package ca.petsearch.controllers;

import com.amazonaws.services.dynamodbv2.AmazonDynamoDB;
import com.amazonaws.services.dynamodbv2.AmazonDynamoDBClientBuilder;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagement;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagementClientBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;

import static ca.petsearch.controllers.SearchControllerIT.localStack;
import static org.testcontainers.containers.localstack.LocalStackContainer.Service.*;

@TestConfiguration
public class AWSTestConfig {

    @Bean
    public AmazonS3 amazonS3() {
        return AmazonS3ClientBuilder.standard()
                .withCredentials(localStack.getDefaultCredentialsProvider())
                .withEndpointConfiguration(localStack.getEndpointConfiguration(S3))
                .build();
    }

    @Bean
    public AmazonDynamoDB amazonDynamoDB() {
        return AmazonDynamoDBClientBuilder.standard()
                .withCredentials(localStack.getDefaultCredentialsProvider())
                .withEndpointConfiguration(localStack.getEndpointConfiguration(DYNAMODB))
                .build();
    }

    @Bean
    public AWSSimpleSystemsManagement awsSimpleSystemsManagement() {
        return AWSSimpleSystemsManagementClientBuilder.standard()
                .withCredentials(localStack.getDefaultCredentialsProvider())
                .withEndpointConfiguration(localStack.getEndpointConfiguration(SSM))
                .build();
    }

}
