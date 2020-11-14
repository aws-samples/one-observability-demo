package main

import (
	"context"
	"database/sql"
	"errors"

	"github.com/go-kit/kit/log"
)

// Repository as an interface to define data store interactions
type Repository interface {
	CreateTransaction(ctx context.Context, tx Transaction) error
}

var RepoErr = errors.New("Unable to handle Repo Request")

//repo as an implementation of Repository with dependency injection
type repo struct {
	db     *sql.DB
	logger log.Logger
	// awsclient awsclient
	//sdk
}

func NewRepository(db *sql.DB, logger log.Logger) Repository {
	return &repo{
		db:     db,
		logger: log.With(logger, "repo", "sql"),
	}
}

func (r *repo) CreateTransaction(ctx context.Context, tx Transaction) error {
	//logger := log.With(r.logger, "method", "CreateTransaction")

	sql := `
		INSERT INTO dbo.transactions (PetId, Transaction_Id, Adoption_Date)
		VALUES (@p1, @p2, @p3)
	`

	r.logger.Log("sql", sql)
	_, err := r.db.ExecContext(ctx, sql, tx.PetID, tx.ID, tx.AdoptionDate)
	if err != nil {
		return err
	}
	return nil
}
