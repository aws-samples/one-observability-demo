package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"

	"petadoptions/payforadoption"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/secretsmanager"
	"github.com/aws/aws-xray-sdk-go/strategy/ctxmissing"
	"github.com/aws/aws-xray-sdk-go/xray"
	_ "github.com/denisenkom/go-mssqldb"
	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/log/level"
	"github.com/spf13/viper"
)

type dbConfig struct {
	Engine, Host, Username, Password string
	Port                             int
}

// config is injected as environment variable
type Config struct {
	UpdateAdoptionURL string
	RDSSecretArn      string
}

//
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

	query := url.Values{}
	// database should be in config
	query.Set("database", "adoptions")

	u := &url.URL{
		Scheme:   c.Engine,
		User:     url.UserPassword(c.Username, c.Password),
		Host:     fmt.Sprintf("%s:%d", c.Host, c.Port),
		RawQuery: query.Encode(),
	}

	return u.String(), nil
}

func main() {
	var (
		httpAddr = flag.String("http.addr", ":80", "HTTP Port binding")
	)

	flag.Parse()

	var logger log.Logger
	{
		//logger = log.NewLogfmtLogger(os.Stderr)
		logger = log.NewJSONLogger(os.Stderr)
		logger = log.With(logger, "ts", log.DefaultTimestampUTC)
		logger = log.With(logger, "caller", log.DefaultCaller)
	}

	viper.SetEnvPrefix("app")
	viper.AutomaticEnv() // Bind automatically all env vars that have the same prefix

	cfg := Config{
		UpdateAdoptionURL: viper.GetString("UPDATE_ADOPTION_URL"),
		RDSSecretArn:      viper.GetString("RDS_SECRET_ARN"),
	}

	xray.Configure(xray.Config{
		ContextMissingStrategy: ctxmissing.NewDefaultLogErrorStrategy(),
	})

	var db *sql.DB
	{
		var err error
		var connStr string

		connStr, err = getRDSConnectionString(cfg.RDSSecretArn)
		if err != nil {
			level.Error(logger).Log("exit", err)
			os.Exit(-1)
		}

		//xray as a wrapper for sql.Open
		db, err = xray.SQLContext("sqlserver", connStr)
		if err != nil {
			level.Error(logger).Log("exit", err)
			os.Exit(-1)
		}
		defer db.Close()
	}

	var s payforadoption.Service
	{
		repo := payforadoption.NewRepository(db, logger)
		s = payforadoption.NewService(logger, repo, cfg.UpdateAdoptionURL)
		s = payforadoption.NewInstrumenting(logger, s)
	}

	var h http.Handler
	{
		h = payforadoption.MakeHTTPHandler(s, logger)
	}

	errs := make(chan error)
	go func() {
		c := make(chan os.Signal)
		signal.Notify(c, syscall.SIGINT, syscall.SIGTERM)
		errs <- fmt.Errorf("%s", <-c)
	}()

	go func() {
		logger.Log("transport", "HTTP", "addr", *httpAddr)
		errs <- http.ListenAndServe(*httpAddr, h)
	}()

	logger.Log("exit", <-errs)
}
