package payforadoption

import "time"

type Adoption struct {
	TransactionID string `json:"transactionid,omitempty"`
	PetID         string `json:"petid,omitempty"`
	PetType       string `json:"pettype,omitempty"`
	AdoptionDate  time.Time
}
