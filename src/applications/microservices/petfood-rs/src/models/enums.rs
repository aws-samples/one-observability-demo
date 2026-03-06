use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// Pet types supported by the system
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PetType {
    Puppy,
    Kitten,
    Bunny,
}

impl fmt::Display for PetType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PetType::Puppy => write!(f, "puppy"),
            PetType::Kitten => write!(f, "kitten"),
            PetType::Bunny => write!(f, "bunny"),
        }
    }
}

impl FromStr for PetType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "puppy" => Ok(PetType::Puppy),
            "kitten" => Ok(PetType::Kitten),
            "bunny" => Ok(PetType::Bunny),
            _ => Err(format!("Invalid pet type: {}", s)),
        }
    }
}

/// Food types available in the system
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FoodType {
    Dry,
    Wet,
    Treats,
    Supplements,
}

impl fmt::Display for FoodType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FoodType::Dry => write!(f, "dry"),
            FoodType::Wet => write!(f, "wet"),
            FoodType::Treats => write!(f, "treats"),
            FoodType::Supplements => write!(f, "supplements"),
        }
    }
}

impl FromStr for FoodType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "dry" => Ok(FoodType::Dry),
            "wet" => Ok(FoodType::Wet),
            "treats" => Ok(FoodType::Treats),
            "supplements" => Ok(FoodType::Supplements),
            _ => Err(format!("Invalid food type: {}", s)),
        }
    }
}

/// Availability status for food products
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AvailabilityStatus {
    InStock,
    OutOfStock,
    Discontinued,
    PreOrder,
}

impl fmt::Display for AvailabilityStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AvailabilityStatus::InStock => write!(f, "in_stock"),
            AvailabilityStatus::OutOfStock => write!(f, "out_of_stock"),
            AvailabilityStatus::Discontinued => write!(f, "discontinued"),
            AvailabilityStatus::PreOrder => write!(f, "pre_order"),
        }
    }
}

impl FromStr for AvailabilityStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "in_stock" => Ok(AvailabilityStatus::InStock),
            "out_of_stock" => Ok(AvailabilityStatus::OutOfStock),
            "discontinued" => Ok(AvailabilityStatus::Discontinued),
            "pre_order" => Ok(AvailabilityStatus::PreOrder),
            _ => Err(format!("Invalid availability status: {}", s)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pet_type_string_conversion() {
        assert_eq!(PetType::Puppy.to_string(), "puppy");
        assert_eq!(PetType::Kitten.to_string(), "kitten");
        assert_eq!(PetType::Bunny.to_string(), "bunny");

        assert_eq!("puppy".parse::<PetType>().unwrap(), PetType::Puppy);
        assert_eq!("KITTEN".parse::<PetType>().unwrap(), PetType::Kitten);
        assert_eq!("Bunny".parse::<PetType>().unwrap(), PetType::Bunny);

        assert!("invalid".parse::<PetType>().is_err());
    }

    #[test]
    fn test_food_type_string_conversion() {
        assert_eq!(FoodType::Dry.to_string(), "dry");
        assert_eq!(FoodType::Wet.to_string(), "wet");
        assert_eq!(FoodType::Treats.to_string(), "treats");
        assert_eq!(FoodType::Supplements.to_string(), "supplements");

        assert_eq!("dry".parse::<FoodType>().unwrap(), FoodType::Dry);
        assert_eq!("WET".parse::<FoodType>().unwrap(), FoodType::Wet);
        assert_eq!("Treats".parse::<FoodType>().unwrap(), FoodType::Treats);

        assert!("invalid".parse::<FoodType>().is_err());
    }

    #[test]
    fn test_serde_serialization() {
        let pet_type = PetType::Puppy;
        let json = serde_json::to_string(&pet_type).unwrap();
        assert_eq!(json, "\"puppy\"");

        let deserialized: PetType = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, PetType::Puppy);
    }
}
