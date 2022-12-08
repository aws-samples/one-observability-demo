package payforadoption

import (
	"fmt"
	"math/rand"
	"strings"
	"time"
)

type CustomerInfo struct {
	ID         int64
	FullName   string
	Address    string
	CreditCard string
	Email      string
}

func getFakeCustomer() CustomerInfo {
	now := time.Now().UnixNano()
	r := rand.New(rand.NewSource(now))
	fullname := fmt.Sprintf("%s %s", getFirstName(r), getLastName(r))

	return CustomerInfo{
		ID:         time.Now().UnixNano(),
		FullName:   fullname,
		Email:      strings.ToLower(fmt.Sprintf("%s.com", strings.ReplaceAll(fullname, " ", "@"))),
		CreditCard: getFakeCreditCard(r),
		Address:    getAddresses(r),
	}
}

func getFakeCreditCard(r *rand.Rand) string {

	//not real cards
	//from https://developer.paypal.com/braintree/docs/guides/credit-cards/testing-go-live/node
	seed := []string{
		"4217651111111119",
		"4500600000000061",
		"4005519200000004",
		"4012000077777777",
		"4012000033330026",
		"2223000048400011",
		"6304000000000000",
	}

	return seed[r.Intn(len(seed))]
}

func getFirstName(r *rand.Rand) string {
	seed := []string{
		"Catherine",
		"Javier",
		"Alex",
		"Frank",
		"Mark",
		"Fatiha",
		"Purva",
		"Selim",
		"Jane",
		"Alan",
		"Mohamed",
	}
	return seed[r.Intn(len(seed))]
}

func getLastName(r *rand.Rand) string {
	seed := []string{
		"Banks",
		"Marley",
		"Konan",
		"Lopez",
		"Gonzales",
		"Levine",
		"Fofana",
		"Hernan",
		"Zheng",
		"Chergui",
		"Mousli",
	}
	return seed[r.Intn(len(seed))]
}

func getAddresses(r *rand.Rand) string {

	// Random addresses
	seed := []string{
		"8 Rue de la Pompe, 75116 Paris",
		"174 Quai de Jemmapes, 75010 Paris, France",
		"60 Holborn Viaduct, London, EC1A 2FD",
		"3333 Piedmont Road NE, Atlanta, GA 30305",
		"2121 7th Ave, Seattle WA, 98121",
		"2021 7th Ave, Seattle WA, 98121",
		"31 place des Corolles, 92400 Courbevoie",
		"120 Avenue de Versailles, 75016 Paris",
	}
	return seed[r.Intn(len(seed))]
}
