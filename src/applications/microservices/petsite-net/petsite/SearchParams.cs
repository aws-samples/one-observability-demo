using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace PetSite
{
    public class SearchParams
    {
        public string pettype { get; set; }
        public string petid { get; set; }
        public string petcolor { get; set; }

        public string petavailability { get; set; }
    }
}
