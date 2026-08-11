#!/usr/bin/env python3
"""Generate photorealistic versions of the bunny images using Amazon Bedrock (Stability).

Same approach as realistic_puppy.py: stability.stable-image-control-structure
re-renders from a text prompt while preserving each input image's pose. The
model takes COLOR and APPEARANCE from the text prompt (not the input image), so
each image has its own coat-color description (the site filters by color) and a
distinct rabbit breed so the faces/features differ. Output is resized back to
the exact input dimensions and saved as JPEG.
"""
import base64
import io
import json
import os
import sys

import boto3
from PIL import Image

REGION = "us-west-2"
MODEL_ID = "us.stability.stable-image-control-structure-v1:0"

SRC_DIR = "static/images/bunnies"
OUT_SUFFIX = "_realistic.jpg"
CONTROL_STRENGTH = 0.55

# Per-image (breed, coat-color). Keys are the source file stems.
# Breeds chosen to MATCH each rabbit's original coat color (so the color filter
# stays accurate) while giving each face distinct features. All originals have
# upright ears, so no lop breeds.
BUNNIES = {
    "b1": (
        "Flemish Giant rabbit",
        "a chestnut-agouti brown coat with black ticking, tan sides and a white belly",
    ),
    "b2": (
        "Belgian Hare rabbit",
        "a rich reddish-brown chestnut coat with tan and white markings",
    ),
    "b3": (
        "chestnut Rex rabbit",
        "a chestnut-agouti brown coat with tan and white markings and dense plush velvet fur",
    ),
    "b4": (
        "broken-pattern Rex rabbit",
        "a predominantly white coat with fawn-orange patches on the ears and around the eyes and nose",
    ),
}

PROMPT_TMPL = (
    "A hyper-realistic professional studio photograph of an adorable {breed} "
    "with {coat}, in the same pose. The face clearly shows {breed} features and "
    "expression. Photorealistic fur with fine individual hairs, natural soft "
    "studio lighting, sharp focus, shallow depth of field, plain light gray "
    "seamless backdrop. Shot on a DSLR, 85mm lens, high detail, lifelike, 8k."
)
NEGATIVE = (
    "wrong fur color, recolored, cartoon, illustration, painting, drawing, cgi, "
    "3d render, blurry, distorted, extra limbs"
)


def process(client, stem, src, out):
    breed, coat = BUNNIES[stem]
    src_img = Image.open(src)
    orig_size = src_img.size  # (width, height)

    with open(src, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode("utf-8")

    body = {
        "prompt": PROMPT_TMPL.format(breed=breed, coat=coat),
        "negative_prompt": NEGATIVE,
        "image": image_b64,
        "control_strength": CONTROL_STRENGTH,
        "output_format": "png",
    }

    resp = client.invoke_model(modelId=MODEL_ID, body=json.dumps(body))
    payload = json.loads(resp["body"].read())

    reasons = payload.get("finish_reasons") or [None]
    if reasons[0]:
        print(f"  ! {os.path.basename(src)}: {reasons[0]}", file=sys.stderr)
        return False

    out_img = Image.open(io.BytesIO(base64.b64decode(payload["images"][0])))
    if out_img.size != orig_size:
        out_img = out_img.resize(orig_size, Image.LANCZOS)
    out_img.convert("RGB").save(out, "JPEG", quality=95)
    return True


def main():
    stems = sorted(BUNNIES.keys(), key=lambda s: int(s[1:]))
    print(f"Processing {len(stems)} images")

    client = boto3.client("bedrock-runtime", region_name=REGION)
    ok = 0
    for stem in stems:
        breed, coat = BUNNIES[stem]
        src = os.path.join(SRC_DIR, stem + ".jpg")
        out = os.path.join(SRC_DIR, stem + OUT_SUFFIX)
        print(f"-> {stem}.jpg  ({breed}, {coat})")
        if process(client, stem, src, out):
            ok += 1
    print(f"Done: {ok}/{len(stems)} generated")


if __name__ == "__main__":
    main()
