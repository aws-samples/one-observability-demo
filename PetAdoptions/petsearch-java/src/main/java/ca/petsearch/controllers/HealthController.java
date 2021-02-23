package ca.petsearch.controllers;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {
    @GetMapping("/health/status")
    public String status(){
        return "Alive";
    }
}
