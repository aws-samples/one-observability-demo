package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"

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
type Config struct {
	PetSearchURL string
	RDSSecretArn string
}

func fetchConfig() (Config, error) {

	// fetch from env
	viper.SetEnvPrefix("app")
	viper.AutomaticEnv() // Bind automatically all env vars that have the same prefix

	cfg := Config{
		PetSearchURL: viper.GetString("PET_SEARCH_URL"),
		RDSSecretArn: viper.GetString("RDS_SECRET_ARN"),
	}

	if cfg.PetSearchURL == "" || cfg.RDSSecretArn == "" {
		return fetchConfigFromParameterStore(os.Getenv("AWS_REGION"))
	}

	return cfg, nil
}

func fetchConfigFromParameterStore(region string) (Config, error) {
	svc := ssm.New(session.New(&aws.Config{Region: aws.String(region)}))
	xray.AWS(svc.Client)
	ctx, seg := xray.BeginSegment(context.Background(), "petlistadoptions")
	defer seg.Close(nil)

	res, err := svc.GetParametersWithContext(ctx, &ssm.GetParametersInput{
		Names: []*string{
			aws.String("/petstore/rdssecretarn"),
			aws.String("/petstore/searchapiurl"),
		},
	})

	cfg := Config{}

	if err != nil {
		return cfg, err
	}

	for _, p := range res.Parameters {
		if aws.StringValue(p.Name) == "/petstore/rdssecretarn" {
			cfg.RDSSecretArn = aws.StringValue(p.Value)
		} else if aws.StringValue(p.Name) == "/petstore/searchapiurl" {
			cfg.PetSearchURL = aws.StringValue(p.Value)
		}
	}

	return cfg, err
}

func getSecretValue(secretID, region string) (string, error) {

	svc := secretsmanager.New(session.New(&aws.Config{Region: aws.String(region)}))
	xray.AWS(svc.Client)
	ctx, seg := xray.BeginSegment(context.Background(), "petlistadoptions")

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
func getRDSConnectionString(secretid string, withPassword bool) (string, error) {
	jsonstr, err := getSecretValue(secretid, os.Getenv("AWS_REGION"))
	if err != nil {
		return "", err
	}

	var c dbConfig

	if err := json.Unmarshal([]byte(jsonstr), &c); err != nil {
		return "", err
	}

	query := url.Values{}
	// database should be in config
	query.Set("database", "adoptions")

	var u *url.URL

	if withPassword {
		u = &url.URL{
			Scheme: c.Engine,
			User:   url.UserPassword(c.Username, c.Password),
			Host:   fmt.Sprintf("%s:%d", c.Host, c.Port),
			Path:   c.Dbname,
		}
	} else {
		u = &url.URL{
			Scheme: c.Engine,
			User:   url.UserPassword(c.Username, ""),
			Host:   fmt.Sprintf("%s:%d", c.Host, c.Port),
			Path:   c.Dbname,
		}
	}

	return u.String(), nil
}
