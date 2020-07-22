#Requires -Modules @{ModuleName='AWS.Tools.Common';ModuleVersion='4.0.5.0'}
#Requires -Modules @{ModuleName='AWS.Tools.SimpleSystemsManagement';ModuleVersion='4.0.5.0'}
#Requires -Modules @{ModuleName='SqlServer';ModuleVersion='21.1.18221'}

function SeedInitialSchema {
    Param(
        [Parameter(Position=1, Mandatory=$false)]
        [int]$MaxRetries = 5,
        [Parameter(Position=2, Mandatory=$false)]
        [int]$Delay = 30
    )

    $script = "./SQL/v1.0.0.sql"
    $dbEndpoint = $env:DbEndpoint
    $usernameParameter = $env:UsernameParameter
    $passwordParameter = $env:PasswordParameter

    $retryAttempt = 0
    do {
        $retryAttempt++
        Write-Host "Starting attempt $retryAttempt"
        try {
            $username = (Get-SSMParameter -Name $usernameParameter -ErrorAction Stop).Value
            $password = (Get-SSMParameter -Name $passwordParameter -ErrorAction Stop).Value
            $connectionString = "Server=${dbEndpoint};User Id=${username};Password=${password}"

            # execute the cript
            Invoke-Sqlcmd -ConnectionString $connectionString -InputFile $script -ErrorAction Stop
            return
        } catch {
            Write-Host ($Error | Format-List -Force | Out-String)
            Write-Error "Retry attempt $retryAttempt failed. $_" -ErrorAction Continue
            if ($retryAttempt -lt $MaxRetries) {
                # Clear error status before next attempt
                $Error.Clear()
                # Wait and repeat
                Write-Host "Wait $Delay seconds before next attempt."
                Start-Sleep -Seconds $Delay
            } else {
                # Throw an error after $MaxRetries unsuccessful invocations.
                Write-Host "Maximum number of retry attempt ($MaxRetries) reached."
                throw $_
            }
        }
    } while ($retryAttempt -lt $MaxRetries)
}

# The following is a standard template for custom resource implementation.
# Note that only Create event is handled. 

$CFNEvent = if ($null -ne $LambdaInput.Records) {
    Write-Host 'Message received via SNS - Parsing out CloudFormation event'
    $LambdaInput.Records[0].Sns.Message
}
else {
    Write-Host 'Event received directly from CloudFormation'
    $LambdaInput
}
$body = @{
    # We'll assume success and overwrite if anything fails in line to avoid code duplication
    Status             = "SUCCESS"
    Reason             = "See the details in CloudWatch Log Stream:`n[Group] $($LambdaContext.LogGroupName)`n[Stream] $($LambdaContext.LogStreamName)"
    StackId            = $CFNEvent.StackId
    RequestId          = $CFNEvent.RequestId
    LogicalResourceId  = $CFNEvent.LogicalResourceId
}
Write-Host "Processing RequestType [$($CFNEvent.RequestType)]"
Write-Host "Resource Properties:"
Write-Host ($CFNEvent.ResourceProperties | Format-List | Out-String)

try {
    # If you want to return data back to CloudFormation, add the Data property to the body with the value as a hashtable. The hashtable keys will be the retrievable attributes when using Fn::GetAtt against the custom resource in your CloudFormation template:
    #    $body.Data = @{Secret = $null}
    switch ($CFNEvent.RequestType) {
            Create {
                    # Add Create request code here
                    SeedInitialSchema
            }
            Update {
                    # Add Update request code here
                    Write-Host 'SQL Seeder does not support schema updates. Return success.'
            }
            Delete {
                    # Add Delete request code here
                    Write-Host 'SQL Seeder does not support deletion of the schema. Return success.'
            }
    }
}
catch {
    Write-Error "Unhandled error during deployment.  $_" -ErrorAction Continue
    if (-not $CFNEvent.ResourceProperties.IgnoreSqlErrors) {
      $body.Reason = "$($body.Reason). $_"
      $body.Status = "FAILED"
    }
}
finally {
    # use the following block without CDK provider framework
    #try {
    #        Invoke-WebRequest -Uri $([Uri]$CFNEvent.ResponseURL) -Method Put -Body $payload
    #}
    #catch {
    #        Write-Error $_
    #}
}

# Return body as lambda response
$payload = (ConvertTo-Json -InputObject $body -Compress -Depth 5)
$payload