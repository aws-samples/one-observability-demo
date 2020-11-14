package main

import "time"

type Transaction struct {
	ID, PetID    string
	AdoptionDate time.Time
}
