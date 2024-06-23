# Pet Recommendation Assistant
Author: Nikhil Kapoor (nikkap@amazon.com, livingmaybe@me.com) Date: 02/10/2024

[Not for public distribution]

This samples application recommends pets suitable to our users bases on their personal circumstances from the all the pets currently available in our Pet Adoption Store.

File Structure:
1. index.html : User Interface to get user inputs and provide recommendations
2. lambda_function.py: Backend that takes user input + Knowledge Base context + instructions to call Bedrock invoke API. It responds with the final recommendation to be served to the user.
3. PetDescriptions.txt : List of pets available for adoption which makes up the Knowledge base data.
4. PetRecommeder_1.png : Architectural diagram of the app.
5. Dashboards/ : Contains JSON source code for the 3 dashboards used to monitor the performance, usage and relevance of this app.

<img width="800" alt="image" src="PetRecommender_1.png">


