/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package payforadoption

import (
	"fmt"
	"net/http"
)

// ServiceError represents an error with an associated HTTP status code
type ServiceError struct {
	Code       int
	Message    string
	Underlying error
}

func (e ServiceError) Error() string {
	if e.Underlying != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Underlying)
	}
	return e.Message
}

func (e ServiceError) Unwrap() error {
	return e.Underlying
}

// HTTPStatusCode returns the HTTP status code for the error
func (e ServiceError) HTTPStatusCode() int {
	return e.Code
}

// Predefined error constructors
func NewNotFoundError(message string, err error) ServiceError {
	return ServiceError{
		Code:       http.StatusNotFound,
		Message:    message,
		Underlying: err,
	}
}

func NewBadRequestError(message string, err error) ServiceError {
	return ServiceError{
		Code:       http.StatusBadRequest,
		Message:    message,
		Underlying: err,
	}
}

func NewInternalError(message string, err error) ServiceError {
	return ServiceError{
		Code:       http.StatusInternalServerError,
		Message:    message,
		Underlying: err,
	}
}

func NewServiceUnavailableError(message string, err error) ServiceError {
	return ServiceError{
		Code:       http.StatusServiceUnavailable,
		Message:    message,
		Underlying: err,
	}
}

// Legacy errors for backward compatibility
var (
	ErrNotFound   = NewNotFoundError("resource not found", nil)
	ErrBadRequest = NewBadRequestError("bad request", nil)
)
