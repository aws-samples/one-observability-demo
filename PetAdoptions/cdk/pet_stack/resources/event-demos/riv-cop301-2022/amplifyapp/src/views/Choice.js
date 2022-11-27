import React, { useContext } from "react";
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import { VoteStatusContext } from "../App";
import { PacmanLoader } from "react-spinners";


export default function Choice() {

    const { color, colorCode } = useContext(VoteStatusContext)
    const styles = {
        minWidth: 27,
        background: colorCode,
        minHeight: 500
    };

    return (

        <Grid item xs={12} sx={{ mt: 9 }}>
            <Card sx={styles}>
                <CardContent align={"center"} sx={{ mt: 9 }}  >
                    <Typography variant="h5" component="div" sx={{ color: 'white', align: 'center', mb: 9 }}>
                        Thank you for voting {color}!
                    </Typography>
                    <PacmanLoader
                        color={"#ffff"}
                        size={30}
                    />
                </CardContent>
            </Card >
        </Grid>
    );
}
