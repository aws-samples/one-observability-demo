import React from "react";
import ProTip from '../components/ProTip';
import ColorCard from '../components/ColorCard';
import Grid from '@mui/material/Grid';
import colors from "../utils/colors";

export default function Colors() {
    return (
        <>
            <ProTip />
            <Grid container spacing={2}>
                {colors.map((c, i) => (
                    <Grid key={i} item xs={c.size}>
                        <ColorCard colorCode={c.code} colorName={c.name} count={0} />
                    </Grid>
                ))}
            </Grid>
        </>
    );
}
