package ca.petsearch;

import com.amazonaws.services.dynamodbv2.AmazonDynamoDB;
import com.amazonaws.services.dynamodbv2.AmazonDynamoDBClientBuilder;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagement;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagementClientBuilder;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.instrumentation.spring.autoconfigure.EnableOpenTelemetryTracing;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Arrays;


@Configuration
@EnableOpenTelemetryTracing
public class WebConfig implements WebMvcConfigurer {

    private final Tracer tracer;

    public WebConfig(Tracer tracer) {
        this.tracer = tracer;
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

    @Bean
    public MetricEmitter metricEmitter() {
        return new MetricEmitter(tracer);
    }

    @Bean
    public FilterRegistrationBean<ApplicationFilter> filterRegistrationBean() {
        FilterRegistrationBean<ApplicationFilter> filterBean = new FilterRegistrationBean<>();
        filterBean.setFilter(new ApplicationFilter(metricEmitter()));
        filterBean.setUrlPatterns(Arrays.asList("/api/search"));
        return filterBean;
    }

}
