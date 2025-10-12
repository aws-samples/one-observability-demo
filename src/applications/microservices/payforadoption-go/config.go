/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package main

import (
	"context"
	"fmt"
	"petadoptions/payforadoption"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	"github.com/spf13/viper"
)

func fetchConfig(ctx context.Context, logger log.Logger) (payforadoption.Config, error) {

	// fetch from env
	viper.AutomaticEnv() // Bind automatically all env vars that have the same prefix

	awsCfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		level.Error(logger).Log("aws", err)
	}

	cfg := payforadoption.Config{
		AWSRegion: viper.GetString("AWS_REGION"),
		AWSCfg:    awsCfg,
	}

	return fetchConfigFromParameterStore(ctx, cfg, logger)
}

func fetchConfigFromParameterStore(ctx context.Context, cfg payforadoption.Config, logger log.Logger) (payforadoption.Config, error) {
	svc := ssm.NewFromConfig(cfg.AWSCfg)

	envVars := map[string]string{
		"PETSTORE_PARAM_PREFIX":                      "",
		"UPDATE_ADOPTIONS_STATUS_URL_PARAMETER_NAME": "",
		"RDS_SECRET_ARN_NAME":                        "",
		"S3_BUCKET_PARAMETER_NAME":                   "",
		"DYNAMODB_TABLE_PARAMETER_NAME":              "",
		"SQS_QUEUE_URL_PARAMETER_NAME":               "",
	}

	for key := range envVars {
		if !viper.IsSet(key) {
			return cfg, fmt.Errorf("%s not set", key)
		}
		envVars[key] = viper.GetString(key)
	}

	prefix := envVars["PETSTORE_PARAM_PREFIX"]

	paramNames := []string{
		fmt.Sprintf("%s/%s", prefix, envVars["UPDATE_ADOPTIONS_STATUS_URL_PARAMETER_NAME"]),
		fmt.Sprintf("%s/%s", prefix, envVars["RDS_SECRET_ARN_NAME"]),
		fmt.Sprintf("%s/%s", prefix, envVars["S3_BUCKET_PARAMETER_NAME"]),
		fmt.Sprintf("%s/%s", prefix, envVars["DYNAMODB_TABLE_PARAMETER_NAME"]),
		fmt.Sprintf("%s/%s", prefix, envVars["SQS_QUEUE_URL_PARAMETER_NAME"]),
	}

	level.Info(logger).Log("msg", "fetching SSM parameters", "names", fmt.Sprintf("%v", paramNames))

	res, err := svc.GetParameters(ctx, &ssm.GetParametersInput{
		Names: paramNames,
	})
	if err != nil {
		level.Error(logger).Log("msg", "failed to fetch SSM parameters", "names", fmt.Sprintf("%v", paramNames), "error", err)
		return cfg, err
	}

	newCfg := payforadoption.Config{
		AWSCfg:    cfg.AWSCfg,
		AWSRegion: cfg.AWSCfg.Region,
	}

	paramMap := make(map[string]*string)
	for _, p := range res.Parameters {
		paramMap[aws.ToString(p.Name)] = p.Value
	}

	if val, ok := paramMap[fmt.Sprintf("%s/%s", prefix, envVars["RDS_SECRET_ARN_NAME"])]; ok {
		newCfg.RDSSecretArn = aws.ToString(val) //pragma: allowlist secret
	}
	if val, ok := paramMap[fmt.Sprintf("%s/%s", prefix, envVars["UPDATE_ADOPTIONS_STATUS_URL_PARAMETER_NAME"])]; ok {
		newCfg.UpdateAdoptionURL = aws.ToString(val)
	}
	if val, ok := paramMap[fmt.Sprintf("%s/%s", prefix, envVars["S3_BUCKET_PARAMETER_NAME"])]; ok {
		newCfg.S3BucketName = aws.ToString(val)
	}
	if val, ok := paramMap[fmt.Sprintf("%s/%s", prefix, envVars["DYNAMODB_TABLE_PARAMETER_NAME"])]; ok {
		newCfg.DynamoDBTable = aws.ToString(val)
	}
	if val, ok := paramMap[fmt.Sprintf("%s/%s", prefix, envVars["SQS_QUEUE_URL_PARAMETER_NAME"])]; ok {
		newCfg.SQSQueueURL = aws.ToString(val)
	}

	return newCfg, nil
}

// Call aws secrets manager and return parsed sql server query str
func getRDSConnectionString(ctx context.Context, cfg payforadoption.Config) (string, error) {
	return payforadoption.GetRDSConnectionString(ctx, cfg)
}
