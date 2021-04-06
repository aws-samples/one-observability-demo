package main

import (
	"database/sql"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"petadoptions/payforadoption"

	"github.com/aws/aws-xray-sdk-go/awsplugins/ecs"
	"github.com/aws/aws-xray-sdk-go/strategy/ctxmissing"
	"github.com/aws/aws-xray-sdk-go/xray"
	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/log/level"
	_ "github.com/lib/pq"
)

func init() {
	// conditionally load plugin
	if os.Getenv("ENVIRONMENT") != "development" {
		ecs.Init()
	}

	xray.Configure(xray.Config{
		ContextMissingStrategy: ctxmissing.NewDefaultLogErrorStrategy(),
	})
}

func main() {
	var (
		httpAddr = flag.String("http.addr", ":80", "HTTP Port binding")
	)

	flag.Parse()

	var logger log.Logger
	{
		logger = log.NewJSONLogger(os.Stderr)
		logger = log.With(logger, "ts", log.DefaultTimestampUTC)
		logger = log.With(logger, "caller", log.DefaultCaller)
	}

	var cfg payforadoption.Config
	{
		var err error
		cfg, err = fetchConfig()
		if err != nil {
			level.Error(logger).Log("exit", err)
			os.Exit(-1)
		}
	}

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
		db, err = xray.SQLContext("postgres", connStr)
		if err != nil {
			level.Error(logger).Log("exit", err)
			os.Exit(-1)
		}
		defer db.Close()
	}

	var s payforadoption.Service
	{
		repo := payforadoption.NewRepository(db, cfg, logger)
		s = payforadoption.NewService(logger, repo)
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
