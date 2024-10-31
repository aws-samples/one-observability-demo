using System.Collections.Generic;
using System.Diagnostics;

namespace trafficgenerator
{
    public class Pet
    {
        public string pettype { get; set; }
        public string petid { get; set; }
        public string petcolor { get; set; }
        public string availability { get; set; }
        public bool IsProcessed { get; set; }    
    }

    public class Pets
    {
        public List<Pet> AllPets { get; set; }
    }
}