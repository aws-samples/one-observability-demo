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

    private String ddbEndpoint = "";
    private String s3Endpoint = "";

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
    public AmazonS3 amazonS3(AWSSimpleSystemsManagement ssmClient) {
        resolveEndpoints(ssmClient);
        String s3Ep = s3Endpoint.isEmpty() ? endpoint : s3Endpoint;
        return s3Ep.isEmpty() ? AmazonS3ClientBuilder.standard().build() :
                AmazonS3ClientBuilder.standard()
                        .withEndpointConfiguration(new AwsClientBuilder.EndpointConfiguration(s3Ep, region))
                        .build();
    }

    @Bean
    public AmazonDynamoDB amazonDynamoDB(AWSSimpleSystemsManagement ssmClient) {
        resolveEndpoints(ssmClient);
        String ddbEp = ddbEndpoint.isEmpty() ? endpoint : ddbEndpoint;
        return ddbEp.isEmpty() ? AmazonDynamoDBClientBuilder.standard().build() :
                AmazonDynamoDBClientBuilder.standard()
                        .withEndpointConfiguration(new AwsClientBuilder.EndpointConfiguration(ddbEp, region))
                        .build();
    }

    @Bean
    public AWSSimpleSystemsManagement awsSimpleSystemsManagement() {
        return withLocalEndpoint(AWSSimpleSystemsManagementClientBuilder.standard())
                .build();
    }

    private void resolveEndpoints(AWSSimpleSystemsManagement ssmClient) {
        if (!ddbEndpoint.isEmpty() || !s3Endpoint.isEmpty()) return;

        String paramPrefix = System.getenv("PETSEARCH_PARAM_PREFIX");
        String ddbParam = System.getenv("DDB_INTERFACE_ENDPOINT_PARAMETER_NAME");
        String s3Param = System.getenv("S3_INTERFACE_ENDPOINT_PARAMETER_NAME");

        if (paramPrefix != null && !paramPrefix.isEmpty()) {
            if (ddbParam != null && !ddbParam.isEmpty()) {
                try {
                    ddbEndpoint = ssmClient.getParameter(new com.amazonaws.services.simplesystemsmanagement.model.GetParameterRequest()
                            .withName(paramPrefix + "/" + ddbParam)).getParameter().getValue();
                } catch (Exception e) {
                    // Endpoint not configured, use default
                }
            }
            if (s3Param != null && !s3Param.isEmpty()) {
                try {
                    s3Endpoint = ssmClient.getParameter(new com.amazonaws.services.simplesystemsmanagement.model.GetParameterRequest()
                            .withName(paramPrefix + "/" + s3Param)).getParameter().getValue();
                } catch (Exception e) {
                    // Endpoint not configured, use default
                }
            }
        }
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
