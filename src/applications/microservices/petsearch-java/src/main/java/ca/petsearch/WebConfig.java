/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package ca.petsearch;

import com.amazonaws.client.builder.AwsClientBuilder;
import com.amazonaws.services.dynamodbv2.AmazonDynamoDB;
import com.amazonaws.services.dynamodbv2.AmazonDynamoDBClientBuilder;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagement;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagementClientBuilder;
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.Tracer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Arrays;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Value("${aws.local.endpoint:#{null}}")
    private String endpoint = "";

    @Value("${cloud.aws.region.static:#{null}}")
    private String region = "";

    @Bean
    public RandomNumberGenerator randomNumberGenerator() {
        return new PseudoRandomNumberGenerator();
    }

    @Bean
    public OpenTelemetry openTelemetry() {
        return GlobalOpenTelemetry.get();
    }

    @Bean
    public Tracer tracer(OpenTelemetry otel) {
        return otel.getTracer("petsearch");
    }

    @Bean
    public AmazonS3 amazonS3() {
        return withLocalEndpoint(AmazonS3ClientBuilder.standard())
                .build();
    }

    @Bean
    public AmazonDynamoDB amazonDynamoDB() {
        return withLocalEndpoint(AmazonDynamoDBClientBuilder.standard())
                .build();
    }

    @Bean
    public AWSSimpleSystemsManagement awsSimpleSystemsManagement() {
        return withLocalEndpoint(AWSSimpleSystemsManagementClientBuilder.standard())
                .build();
    }

    private <Subclass extends AwsClientBuilder<Subclass, ?>> Subclass withLocalEndpoint(Subclass builder) {
        return endpoint.isEmpty() ? builder : builder.withEndpointConfiguration(new AwsClientBuilder.EndpointConfiguration(endpoint, region));
    }

    @Bean
    public MetricEmitter metricEmitter(OpenTelemetry otel) {
        return new MetricEmitter(otel);
    }

    @Bean
    public FilterRegistrationBean<ApplicationFilter> filterRegistrationBean(MetricEmitter metricEmitter) {
        FilterRegistrationBean<ApplicationFilter> filterBean = new FilterRegistrationBean<>();
        filterBean.setFilter(new ApplicationFilter(metricEmitter));
        filterBean.setUrlPatterns(Arrays.asList("/api/search"));
        return filterBean;
    }

}
