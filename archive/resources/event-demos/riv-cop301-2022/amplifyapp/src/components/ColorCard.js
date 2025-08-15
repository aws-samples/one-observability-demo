/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useContext } from 'react';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import CardActionArea from '@mui/material/CardActionArea';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { vote } from '../utils/api';
import { VoteStatusContext } from '../App';
import { SyncLoader } from 'react-spinners';

const ColorCard = ({ colorName, colorCode }) => {
    const { setVoted, setColor, setColorCode } = useContext(VoteStatusContext);
    const [loading, setLoading] = useState(false);

    const styles = {
        minWidth: 27,
        background: colorCode,
    };

    const handleUpdateVote = async () => {
        setLoading(true);
        const response = await vote(colorName);
        setVoted(true);
        setColor(colorName);
        setColorCode(colorCode);
        console.log(response);
        setLoading(false);
    };

    return (
        <Card sx={styles}>
            <CardActionArea onClick={handleUpdateVote} disabled={loading}>
                <CardContent>
                    <Typography
                        variant="h5"
                        component="div"
                        sx={{ color: 'white', background: { colorCode }, mt: 3, mb: 3 }}
                    >
                        {colorName}
                    </Typography>
                    <SyncLoader color={'#fafafa'} loading={loading} size={5} />
                </CardContent>
            </CardActionArea>
        </Card>
    );
};

export default ColorCard;
