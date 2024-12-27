package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"petadoptions/payforadoption"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	"github.com/spf13/viper"
)

type dbConfig struct {
	Engine, Host, Username, Password, Dbname string
	Port                                     int
}

// config is injected as environment variable

func fetchConfig(ctx context.Context, logger log.Logger) (payforadoption.Config, error) {

	// fetch from env
	viper.AutomaticEnv() // Bind automatically all env vars that have the same prefix

	awsCfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		level.Error(logger).Log("aws", err)
	}

	cfg := payforadoption.Config{
		UpdateAdoptionURL: viper.GetString("UPDATE_ADOPTION_URL"),
		RDSSecretArn:      viper.GetString("RDS_SECRET_ARN"),
		AWSRegion:         viper.GetString("AWS_REGION"),
		AWSCfg:            awsCfg,
	}

	if cfg.UpdateAdoptionURL == "" || cfg.RDSSecretArn == "" {
		return fetchConfigFromParameterStore(ctx, cfg)
	}

	return cfg, nil
}

func fetchConfigFromParameterStore(ctx context.Context, cfg payforadoption.Config) (payforadoption.Config, error) {
	svc := ssm.NewFromConfig(cfg.AWSCfg)

	res, err := svc.GetParameters(ctx, &ssm.GetParametersInput{
		Names: []string{
			"/petstore/updateadoptionstatusurl",
			"/petstore/rdssecretarn",
			"/petstore/s3bucketname",
			"/petstore/dynamodbtablename",
		},
	})

	newCfg := payforadoption.Config{}
	newCfg.AWSCfg = cfg.AWSCfg
	newCfg.AWSRegion = cfg.AWSCfg.Region

	if err != nil {
		return newCfg, err
	}

	for _, p := range res.Parameters {

		pValue := aws.ToString(p.Value)

		switch aws.ToString(p.Name) {
		case "/petstore/rdssecretarn":
			newCfg.RDSSecretArn = pValue
		case "/petstore/updateadoptionstatusurl":
			newCfg.UpdateAdoptionURL = pValue
		case "/petstore/s3bucketname":
			newCfg.S3BucketName = pValue
		case "/petstore/dynamodbtablename":
			newCfg.DynamoDBTable = pValue
		}
	}

	return newCfg, err
}

func getSecretValue(ctx context.Context, cfg payforadoption.Config) (string, error) {

	svc := secretsmanager.NewFromConfig(cfg.AWSCfg)

	res, err := svc.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
		SecretId: aws.String(cfg.RDSSecretArn),
	})

	if err != nil {
		return "", err
	}

	return aws.ToString(res.SecretString), nil
}

// Call aws secrets manager and return parsed sql server query str
func getRDSConnectionString(ctx context.Context, cfg payforadoption.Config) (string, error) {
	jsonstr, err := getSecretValue(ctx, cfg)
	if err != nil {
		return "", err
	}

	var c dbConfig

	if err := json.Unmarshal([]byte(jsonstr), &c); err != nil {
		return "", err
	}

	u := &url.URL{
		Scheme: c.Engine,
		User:   url.UserPassword(c.Username, c.Password),
		Host:   fmt.Sprintf("%s:%d", c.Host, c.Port),
		Path:   c.Dbname,
	}

	return u.String(), nil
}
