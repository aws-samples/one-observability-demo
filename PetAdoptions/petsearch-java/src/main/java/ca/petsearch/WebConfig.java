package ca.petsearch;

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
                .withPlugin(new ECSPlugin()).withPlugin(new EKSPlugin());

        builder.withSamplingStrategy(new DefaultSamplingStrategy());

        AWSXRay.setGlobalRecorder(builder.build());
    }

    @Bean
    public Filter tracingFilter() {
        return new AWSXRayServletFilter("petstore");
    }

}
