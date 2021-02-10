package ca.petsearch;

import com.amazonaws.services.dynamodbv2.AmazonDynamoDB;
import com.amazonaws.services.dynamodbv2.AmazonDynamoDBClientBuilder;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagement;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagementClientBuilder;
import com.amazonaws.xray.AWSXRay;
import com.amazonaws.xray.AWSXRayRecorderBuilder;
import com.amazonaws.xray.javax.servlet.AWSXRayServletFilter;
import com.amazonaws.xray.plugins.ECSPlugin;
import com.amazonaws.xray.plugins.EKSPlugin;
import com.amazonaws.xray.strategy.sampling.DefaultSamplingStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.servlet.Filter;

@Configuration
public class WebConfig {

    static {
        AWSXRayRecorderBuilder builder = AWSXRayRecorderBuilder.standard()
                .withPlugin(new ECSPlugin());

        builder.withSamplingStrategy(new DefaultSamplingStrategy());

        AWSXRay.setGlobalRecorder(builder.build());
    }

    @Bean
    public Filter tracingFilter() {
        return new AWSXRayServletFilter("petstore");
    }

    @Bean
    public AmazonS3 amazonS3() {
        return AmazonS3ClientBuilder.standard()
                .build();
    }

    @Bean
    public AmazonDynamoDB amazonDynamoDB() {
        return AmazonDynamoDBClientBuilder.standard()
                .build();
    }

    @Bean
    public AWSSimpleSystemsManagement awsSimpleSystemsManagement() {
        return AWSSimpleSystemsManagementClientBuilder.standard()
                .build();
    }

}
