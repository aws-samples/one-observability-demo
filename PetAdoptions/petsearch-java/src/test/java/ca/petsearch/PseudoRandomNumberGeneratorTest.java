package ca.petsearch;

import io.vavr.CheckedFunction1;
import io.vavr.test.Arbitrary;
import io.vavr.test.CheckResult;
import io.vavr.test.Property;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;
import java.util.Set;

public class PseudoRandomNumberGeneratorTest {

    @Test
    public void testNonNegativeNumber() {
        PseudoRandomNumberGenerator generator = new PseudoRandomNumberGenerator();

        Arbitrary<Integer> nonNegative = Arbitrary.integer()
                .filter(i -> i >= 0);

        CheckedFunction1<Integer, Boolean> mustBeNonNegative
                = i -> {
            int n = generator.nextNonNegativeInt(i);
            return n < i && n >= 0;
        };

        CheckResult result = Property
                .def("Every random number need to be non-negative and smaller than the given parameter")
                .forAll(nonNegative)
                .suchThat(mustBeNonNegative)
                .check(10_000, 100);

        result.assertIsSatisfied();
    }

    @Test
    public void testRandomDistribution() {
        PseudoRandomNumberGenerator generator = new PseudoRandomNumberGenerator();
        Map<Integer, Integer> distribution = new HashMap<>();

        for (int i = 0; i < 10000; i++) {
            int generated = generator.nextNonNegativeInt(10);
            if (distribution.containsKey(generated)) {
                distribution.put(generated, distribution.get(generated) + 1);
            } else {
                distribution.put(generated, 1);
            }
        }

        assertThat(distribution.keySet().size()).isGreaterThanOrEqualTo(5).isLessThanOrEqualTo(10);
        assertThat(distribution.get(3)).isGreaterThanOrEqualTo(900).isLessThanOrEqualTo(1100);
    }

}
