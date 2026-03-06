/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package ca.petsearch;

public class PseudoRandomNumberGenerator implements RandomNumberGenerator {

    @Override
    public int nextNonNegativeInt(int max) {
        if (max < 0) throw new RuntimeException("Wrong parameter value");
        return (int) (Math.random() * max);
    }
}
