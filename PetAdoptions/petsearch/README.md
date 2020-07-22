## [INCOMPLETE] How to create an ElasticBeanstalk deployment package

### Install EB CLI

https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/eb-cli3-install-advanced.html

### Configure the Elastic Beanstalk environment

https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/eb-cli3-configuration.html

``` 
cd /petsearch/site
eb init
```

> Select **.NET on Windows Server** as the platform during setup
> Select **IIS 10.0 running on 64bit Windows Server 2019** as platform branch

### Create a new Beanstalk environment

The following command will create a new Beanstalk environment with a single instance (No ELB)

```
eb create petsearch-dev -s -r us-east-2 -c <UNIQUE_CNAME> -sr petsearch-live
```

Once the environment is created successfully, execute the following command to see the default application

```
eb open
```

>Example: eb create petsearch-dev -s -r us-east-2 -c ijagannapetSearch -sr petsearch-live
Wait for a few minutes for the environment to be ready.

### Build the PetSearch Elastic Beanstalk packge

```
docker run --rm -it -v $(pwd):/mnt/petsearch mcr.microsoft.com/dotnet/core/sdk:3.1
```
Once inside the docker container, type the following commands. This will build the project and publish the output files to a folder called _site_

```
cd /mnt/petseach
dotnet publish -o site
```
Exit out of the container by typing the following command

```
exit
```
On your local machine now you should see a folder called _site_ with the build output.


### Zip the package for deployment

Execute the following command to zip all the output contents inside _site_ folder into a zip file called _site.zip_

```
zip site.zip site/*
```

Now add the deployment config into the zip file by executing the following command. This will produce another zip file called _petsearch.zip_

```
zip petsearch.zip site.zip aws-windows-deployment-manifest.json
```


