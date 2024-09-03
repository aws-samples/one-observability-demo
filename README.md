## One Observability Demo

This repo contains a sample application which is used in the One Observability Demo workshop here - https://observability.workshop.aws/

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## Instructions

To deploy this workshop on your own account you need to have an IAM role with elevated priviliges and the `aws-cli` installed. Then, from the root
of the repository run the following command:

```
aws cloudformation create-stack --stack-name Observability-Workshop --template-body file://codepipeline-stack.yaml --capabilities CAPABILITY_NAMED_IAM --parameters ParameterKey=UserRoleArn,ParameterValue=$(aws sts get-caller-identity --query Arn --output text)
```

You can replace the role specified in the paramter `UserRoleArn` with any other role with access to AWS CloudShell if you need so.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

