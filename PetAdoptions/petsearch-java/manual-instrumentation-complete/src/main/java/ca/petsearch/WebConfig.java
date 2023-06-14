package ca.petsearch;

import com.amazonaws.client.builder.AwsClientBuilder;
import com.amazonaws.services.dynamodbv2.AmazonDynamoDB;
import com.amazonaws.services.dynamodbv2.AmazonDynamoDBClientBuilder;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagement;
import com.amazonaws.services.simplesystemsmanagement.AWSSimpleSystemsManagementClientBuilder;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.context.propagation.ContextPropagators;
import io.opentelemetry.context.propagation.TextMapPropagator;
import io.opentelemetry.contrib.aws.resource.EcsResource;
import io.opentelemetry.contrib.awsxray.AwsXrayIdGenerator;
import io.opentelemetry.contrib.awsxray.propagator.AwsXrayPropagator;
import io.opentelemetry.exporter.otlp.trace.OtlpGrpcSpanExporter;
import io.opentelemetry.instrumentation.awssdk.v1_11.AwsSdkTelemetry;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.resources.Resource;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor;
import io.opentelemetry.semconv.resource.attributes.ResourceAttributes;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
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

        // Extract OpenTelemetry variables
        // https://opentelemetry.io/docs/reference/specification/sdk-environment-variables/#general-sdk-configuration
        Attributes serviceName = Attributes.of(ResourceAttributes.SERVICE_NAME, System.getenv().getOrDefault("OTEL_SERVICE_NAME", "PetSearch"));
        // https://opentelemetry.io/docs/concepts/sdk-configuration/otlp-exporter-configuration/#otel_exporter_otlp_endpoint
        String exporterEndpoint = System.getenv().getOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317");
        Resource resource = Resource.getDefault()
                .merge(Resource.create(serviceName))
                // ECS Resource detector. Detect attributes of the ECS environment where the task is running.
                .merge(EcsResource.get());
        return OpenTelemetrySdk.builder()
                // This will enable your downstream requests to include the X-Ray trace header
                .setPropagators(
                        ContextPropagators.create(
                                TextMapPropagator.composite(
                                        W3CTraceContextPropagator.getInstance(), AwsXrayPropagator.getInstance())))

                // This provides basic configuration of a TracerProvider which generates X-Ray compliant IDs
                .setTracerProvider(
                        SdkTracerProvider.builder()
                                .setResource(resource)
                                .addSpanProcessor(
                                        BatchSpanProcessor.builder(
                                                OtlpGrpcSpanExporter.builder()
                                                        .setEndpoint(exporterEndpoint)
                                                        .build()
                                                ).build())
                                .setIdGenerator(AwsXrayIdGenerator.getInstance())
                                .build())
                .buildAndRegisterGlobal();
    }

    @Bean
    public Tracer getTracer(OpenTelemetry otel) {
        return otel.getTracer("petsearch");
    }


    private Tracer tracer;
    @Autowired
    public void setTracer(@Lazy Tracer tracer) {
        this.tracer = tracer;
    }

    private OpenTelemetry openTelemetry;

    @Autowired
    public void setOpenTelemetry(@Lazy OpenTelemetry otel){
        this.openTelemetry = otel;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new TracingRequestInterceptor(openTelemetry, tracer));
        WebMvcConfigurer.super.addInterceptors(registry);
    }

    @Bean
    public AmazonS3 amazonS3(OpenTelemetry otel) {
        return withLocalEndpoint(withInstrumentation(AmazonS3ClientBuilder.standard(), otel)).build();
    }

    @Bean
    public AmazonDynamoDB amazonDynamoDB(OpenTelemetry otel) {
        return withLocalEndpoint(withInstrumentation(AmazonDynamoDBClientBuilder.standard(), otel))
                .build();
    }

    @Bean
    public AWSSimpleSystemsManagement awsSimpleSystemsManagement(OpenTelemetry otel) {
        return withLocalEndpoint(withInstrumentation(AWSSimpleSystemsManagementClientBuilder.standard(), otel))
                .build();
    }

    private <Subclass extends AwsClientBuilder<Subclass, ?>> Subclass withInstrumentation(Subclass builder, OpenTelemetry otel) {
        return builder.withRequestHandlers(AwsSdkTelemetry.builder(otel).build().newRequestHandler());
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
