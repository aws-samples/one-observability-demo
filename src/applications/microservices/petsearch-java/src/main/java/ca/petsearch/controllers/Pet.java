/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package ca.petsearch.controllers;

public class Pet {

    private final String petid;
    private final String availability;
    private final String cuteness_rate;
    private final String petcolor;
    private final String pettype;
    private final String price;
    private final String peturl;

    public Pet(
            String petid,
            String availability,
            String cuteness_rate,
            String petcolor,
            String pettype,
            String price,
            String peturl
    ) {
        this.petid = petid;
        this.availability = availability;
        this.cuteness_rate = cuteness_rate;
        this.petcolor = petcolor;
        this.pettype = pettype;
        this.price = price;
        this.peturl = peturl;
    }

    public String getPetid() {
        return petid;
    }
    public String getAvailability() {
        return availability;
    }
    public String getCuteness_rate() {
        return cuteness_rate;
    }
    public String getPetcolor() {
        return petcolor;
    }
    public String getPettype() {
        return pettype;
    }
    public String getPrice() {
        return price;
    }
    public String getPeturl() {
        return peturl;
    }

}
