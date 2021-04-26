package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"petadoptions/payforadoption"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/secretsmanager"
	"github.com/aws/aws-sdk-go/service/ssm"
	"github.com/aws/aws-xray-sdk-go/xray"
	"github.com/spf13/viper"
)

type dbConfig struct {
	Engine, Host, Username, Password, Dbname string
	Port                                     int
}

// config is injected as environment variable

func fetchConfig() (payforadoption.Config, error) {

	// fetch from env
	viper.AutomaticEnv() // Bind automatically all env vars that have the same prefix

	cfg := payforadoption.Config{
		UpdateAdoptionURL: viper.GetString("UPDATE_ADOPTION_URL"),
		RDSSecretArn:      viper.GetString("RDS_SECRET_ARN"),
		AWSRegion:         viper.GetString("AWS_REGION"),
	}

	if cfg.UpdateAdoptionURL == "" || cfg.RDSSecretArn == "" {
		return fetchConfigFromParameterStore(cfg.AWSRegion)
	}

	return cfg, nil
}

func fetchConfigFromParameterStore(region string) (payforadoption.Config, error) {
	svc := ssm.New(session.New(&aws.Config{Region: aws.String(region)}))
	xray.AWS(svc.Client)
	ctx, seg := xray.BeginSegment(context.Background(), "payforadoption")
	defer seg.Close(nil)

	res, err := svc.GetParametersWithContext(ctx, &ssm.GetParametersInput{
		Names: []*string{
			aws.String("/petstore/updateadoptionstatusurl"),
			aws.String("/petstore/rdssecretarn"),
			aws.String("/petstore/s3bucketname"),
			aws.String("/petstore/dynamodbtablename"),
		},
	})

	cfg := payforadoption.Config{}
	cfg.AWSRegion = region

	if err != nil {
		return cfg, err
	}

	for _, p := range res.Parameters {

		switch aws.StringValue(p.Name) {
		case "/petstore/rdssecretarn":
			cfg.RDSSecretArn = aws.StringValue(p.Value)
		case "/petstore/updateadoptionstatusurl":
			cfg.UpdateAdoptionURL = aws.StringValue(p.Value)
		case "/petstore/s3bucketname":
			cfg.S3BucketName = aws.StringValue(p.Value)
		case "/petstore/dynamodbtablename":
			cfg.DynamoDBTable = aws.StringValue(p.Value)
		}
	}

	return cfg, err
}

func getSecretValue(secretID, region string) (string, error) {

	svc := secretsmanager.New(session.New(&aws.Config{Region: aws.String(region)}))
	xray.AWS(svc.Client)
	ctx, seg := xray.BeginSegment(context.Background(), "payforadoption")

	res, err := svc.GetSecretValueWithContext(ctx, &secretsmanager.GetSecretValueInput{
		SecretId: aws.String(secretID),
	})
	seg.Close(nil)

	if err != nil {
		return "", err
	}

	return aws.StringValue(res.SecretString), nil
}

// Call aws secrets manager and return parsed sql server query str
func getRDSConnectionString(secretid string) (string, error) {
	jsonstr, err := getSecretValue(secretid, os.Getenv("AWS_REGION"))
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
