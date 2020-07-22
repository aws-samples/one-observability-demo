using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace PetSearch
{
    public class Pet
    {
        public string pettype { get; set; }
        public string petid { get; set; }
        public string price { get; set; }
        public string petcolor { get; set; }
        public string cuteness_rate { get; set; }
        public string availability { get; set; }
        public string image { get; set; }
        public string peturl { get; set; }
    }

    public class SearchParams
    {
        public string pettype { get; set; }
        public string petid { get; set; }
        public string petcolor { get; set; }
    }
}
