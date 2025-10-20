/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package main

import (
	"testing"
)

func TestExtractSQLOperation(t *testing.T) {
	processor := &SQLSpanProcessor{}

	tests := []struct {
		name     string
		query    string
		expected string
	}{
		{
			name:     "INSERT query",
			query:    "INSERT INTO transactions (pet_id, adoption_date, transaction_id, user_id) VALUES ($1, $2, $3, $4)",
			expected: "INSERT INTO",
		},
		{
			name:     "SELECT query",
			query:    "SELECT * FROM pets WHERE id = $1",
			expected: "SELECT",
		},
		{
			name:     "UPDATE query",
			query:    "UPDATE pets SET status = $1 WHERE id = $2",
			expected: "UPDATE",
		},
		{
			name:     "DELETE query",
			query:    "DELETE FROM pets WHERE id = $1",
			expected: "DELETE",
		},
		{
			name:     "Empty query",
			query:    "",
			expected: "UnknownRemoteOperation",
		},
		{
			name:     "Unknown query",
			query:    "EXPLAIN SELECT * FROM pets",
			expected: "UnknownRemoteOperation",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := processor.extractSQLOperation(tt.query)
			if result != tt.expected {
				t.Errorf("extractSQLOperation(%q) = %q, want %q", tt.query, result, tt.expected)
			}
		})
	}
}
