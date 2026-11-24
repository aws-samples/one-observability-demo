# Omni use-case simulation scripts (payment service)

These scripts support the Amazon CloudWatch Omni application observability use case "Fix failing payments after a configuration change" of the [One Observability Workshop](https://observability.workshop.aws/). They stage and reverse the payment incident, so they are not part of the running application.

Run them from this folder, `src/applications/microservices/payforadoption-go/omni-use-cases-simulation-scripts/`, in your `one-observability-demo` checkout. The use-case pages tell you when to run each one. All scripts are safe to run more than once.

| Script | What it does |
| --- | --- |
| `inject-fault.sh` | Ships this morning's configuration change to the payment service, redeploys `payforadoption-go`, and sends payments through PetSite in the background until `restore-payments.sh` stops them (`-y` skips the question) |
| `redeploy-payforadoption.sh` | Redeploys `payforadoption-go` so it reads its configuration again, and waits until only the new tasks receive traffic |
| `send-payments.sh [count]` | Sends adoption payments through PetSite, one every 5 seconds (default 60) |
| `restore-payments.sh` | Lists what it will change, then stops the background payments, restores the configuration the workshop deployed, redeploys `payforadoption-go`, removes the payments recorded during the incident, and checks that a payment adopts a pet (`-y` skips the question) |
