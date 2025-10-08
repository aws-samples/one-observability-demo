/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package ca.petsearch.controllers;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {
    
    private static final Logger logger = LoggerFactory.getLogger(HealthController.class);
    
    @GetMapping("/health/status")
    public String status(){
        logger.info("Health check endpoint accessed - service is alive");
        logger.debug("Health status check completed successfully");
        return "Alive";
    }
}
