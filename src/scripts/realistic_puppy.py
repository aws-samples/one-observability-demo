#!/usr/bin/env python3
"""Generate photorealistic versions of the puppy images using Amazon Bedrock (Stability).

Uses stability.stable-image-control-structure, which re-renders from a text
prompt while preserving the structure/pose of each input image. This model
takes COLOR and APPEARANCE from the text prompt (not the input image), so each
image has:
  - its own coat-color description, to preserve the animal's original color
    (the site filters puppies by color), and
  - a distinct breed, so the faces/features differ from one another.
control_strength is kept moderate so breed features (ear shape, muzzle,
fur texture) come through while the original pose is preserved. Output is
resized back to the exact input dimensions and saved as JPEG.
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

SRC_DIR = "static/images/puppies"
OUT_SUFFIX = "_realistic.jpg"
CONTROL_STRENGTH = 0.55

# Per-image (breed, coat-color). Keys are the source file stems.
# Breeds are chosen to MATCH each dog's original coat color so the site's
# color filter stays accurate, while giving each face distinct features.
DOGS = {
    "p1": ("Vizsla", "a golden-brown and tan coat"),
    "p2": ("Brittany Spaniel", "a white coat with ginger-brown patches on the ears and face"),
    "p3": ("Belgian Malinois", "a brown and tan coat with a darker brown muzzle"),
    "p4": ("Beagle", "a brown and white coat"),
    "p5": ("Great Pyrenees", "a pure white coat with a faint cream tint"),
    "p6": ("Boxer", "a tan-brown coat with a small white marking on the chest"),
    "p7": ("Basenji", "a reddish-brown ginger coat with a white chest and muzzle"),
    "p8": ("Rhodesian Ridgeback", "a tan-brown coat with a white chest marking"),
    "p9": ("Border Collie", "a glossy black coat with a white patch on the chest"),
    "p10": ("Labrador Retriever", "a glossy black coat with a small white marking on the chest"),
    "p11": ("Cocker Spaniel", "a glossy black coat with a small white patch on the chest"),
    "p12": ("Flat-Coated Retriever", "a solid glossy black coat"),
    "p13": ("Rottweiler", "a black-and-tan coat with tan markings on the eyebrows, muzzle, ears and legs"),
    "p14": ("Jack Russell Terrier", "a predominantly white coat with only small apricot-tan patches on the ears"),
    "p15": ("Samoyed", "a white and cream coat"),
}

PROMPT_TMPL = (
    "A hyper-realistic professional studio photograph of an adorable {breed} "
    "puppy with {coat}, in the same pose. The face clearly shows {breed} "
    "features and expression. Photorealistic fur with fine individual hairs, "
    "natural soft studio lighting, sharp focus, shallow depth of field, plain "
    "light gray seamless backdrop. Shot on a DSLR, 85mm lens, high detail, "
    "lifelike, 8k."
)
NEGATIVE = (
    "wrong fur color, recolored, cartoon, illustration, painting, drawing, cgi, "
    "3d render, blurry, distorted, extra limbs"
)


def process(client, stem, src, out):
    breed, coat = DOGS[stem]
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
    stems = sorted(DOGS.keys(), key=lambda s: int(s[1:]))
    print(f"Processing {len(stems)} images")

    client = boto3.client("bedrock-runtime", region_name=REGION)
    ok = 0
    for stem in stems:
        breed, coat = DOGS[stem]
        src = os.path.join(SRC_DIR, stem + ".jpg")
        out = os.path.join(SRC_DIR, stem + OUT_SUFFIX)
        print(f"-> {stem}.jpg  ({breed}, {coat})")
        if process(client, stem, src, out):
            ok += 1
    print(f"Done: {ok}/{len(stems)} generated")


if __name__ == "__main__":
    main()
