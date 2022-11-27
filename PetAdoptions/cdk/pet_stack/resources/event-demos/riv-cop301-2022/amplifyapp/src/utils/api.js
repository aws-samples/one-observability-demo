import { Amplify } from "aws-amplify";

const apiName = "voteapi";

export async function vote(
    colorName,
) {
    const path = `/votes`;
    const reqBody = {
        body: {
            color: colorName,
        },
    };
    return await Amplify.API.post(apiName, path, reqBody);
    // await new Promise(r => setTimeout(r, 1000));
}