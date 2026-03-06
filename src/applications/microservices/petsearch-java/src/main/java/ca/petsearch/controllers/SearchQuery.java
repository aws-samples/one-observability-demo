/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package ca.petsearch.controllers;

/**
 * Search query parameters with support for multiple parameter name aliases
 * Similar to the petfood Rust application's parameter handling
 */
public class SearchQuery {
    private String petType;
    private String petColor;
    private String petId;

    public SearchQuery() {}

    public SearchQuery(String petType, String petColor, String petId) {
        this.petType = petType;
        this.petColor = petColor;
        this.petId = petId;
    }

    // Getters and setters
    public String getPetType() {
        return petType;
    }

    public void setPetType(String petType) {
        this.petType = petType;
    }

    public String getPetColor() {
        return petColor;
    }

    public void setPetColor(String petColor) {
        this.petColor = petColor;
    }

    public String getPetId() {
        return petId;
    }

    public void setPetId(String petId) {
        this.petId = petId;
    }

    /**
     * Check if a parameter is empty (null or blank)
     */
    public static boolean isEmptyParameter(String param) {
        return param == null || param.trim().isEmpty();
    }

    /**
     * Normalize and validate pet type parameter
     */
    public String getValidatedPetType() {
        if (isEmptyParameter(petType)) {
            return "";
        }
        return petType.toLowerCase().trim();
    }

    /**
     * Normalize pet color parameter
     */
    public String getNormalizedPetColor() {
        if (isEmptyParameter(petColor)) {
            return "";
        }
        return petColor.toLowerCase().trim();
    }

    /**
     * Normalize pet ID parameter
     */
    public String getNormalizedPetId() {
        if (isEmptyParameter(petId)) {
            return "";
        }
        return petId.trim();
    }
}
