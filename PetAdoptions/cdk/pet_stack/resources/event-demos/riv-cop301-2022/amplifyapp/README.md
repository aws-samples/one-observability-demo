# Web application with AWS Amplify

This project was bootstrapped with AWS Amplify. 

## Pre-requisites

1. Install [AWS Amplify CLI](https://docs.amplify.aws/cli/start/install/)
2. Edit `amplifyapp/src/index.js` and replace `endpoint: $ECS_API_URL` with the Amazon ECS deployment URL

## Run locally

In the project directory, you can run:

```console
npm install
npm start
```

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.


## Deployment

Install [AWS Amplify CLI](https://docs.amplify.aws/cli/start/install/)

```console
npm install
amplify publish
```
