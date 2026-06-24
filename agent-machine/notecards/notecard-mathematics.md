# mathematics — canonical reference (authored canon, the exam note card)


## descriptive
- **Sample mean**: `xbar = sum(xi) / n`
- **Sample standard deviation**: `s = sqrt( sum((xi - xbar)^2) / (n - 1) )`

## distributions
- **z-score**: `z = (x - mu) / sigma`
- **Binomial mean**: `mu = n p`
- **Binomial sd**: `sigma = sqrt(n p (1 - p))`
- **Poisson distribution**: `P(X=k) = lambda^k e^-lambda / k!`
- **Normal density**: `f(x) = (1/(sigma sqrt(2 pi))) exp(-(x-mu)^2/(2 sigma^2))`

## inference
- **Standard error of mean**: `SE = sigma / sqrt(n)`
- **Confidence interval**: `estimate +/- (critical value)(standard error)`
- **z test statistic**: `z = (xbar - mu0) / (sigma / sqrt(n))`
- **t test statistic**: `t = (xbar - mu0) / (s / sqrt(n))`
- **Chi-square statistic**: `chi^2 = sum( (O - E)^2 / E )`
- **Central limit theorem**: `xbar ~ Normal(mu, sigma^2 / n) as n grows`
- **Two-proportion z**: `z = (p1hat - p2hat) / sqrt(phat(1-phat)(1/n1 + 1/n2))`
- **p-value rule**: `reject H0 if p < alpha`

## probability
- **Complement**: `P(not A) = 1 - P(A)`
- **Conditional probability**: `P(A | B) = P(A and B) / P(B)`
- **Expected value**: `E(X) = sum( xi P(xi) )`
- **Variance**: `Var(X) = E(X^2) - (E(X))^2`
- **Bayes' theorem**: `P(A|B) = P(B|A) P(A) / P(B)`

## regression
- **Correlation slope**: `b = r (sy / sx)`
- **Regression line**: `yhat = a + b x`
- **Coefficient of determination**: `R^2 = 1 - SSE/SST`

## algebra
- **Quadratic formula**: `x = (-b +/- sqrt(b^2 - 4 a c)) / (2 a)`
- **Slope**: `m = (y2 - y1) / (x2 - x1)`
- **Line**: `y = m x + b`
- **Log product rule**: `log(a b) = log(a) + log(b)`

## calculus
- **Power rule (derivative)**: `d/dx x^n = n x^(n-1)`
- **Product rule**: `(u v)' = u' v + u v'`
- **Chain rule**: `(f(g(x)))' = f'(g(x)) g'(x)`
- **Power rule (integral)**: `integral x^n dx = x^(n+1) / (n+1) + C`
- **Fundamental theorem**: `integral_a^b f'(x) dx = f(b) - f(a)`
- **Derivative definition**: `f'(x) = lim_{h->0} (f(x+h) - f(x)) / h`

## combinatorics
- **Binomial coefficient**: `C(n, k) = n! / (k! (n-k)!)`

## field_theory
- **Fundamental theorem of algebra**: `every nonconstant polynomial over C has a root in C`

## geometry
- **Pythagorean theorem**: `a^2 + b^2 = c^2`
- **Distance formula**: `d = sqrt((x2 - x1)^2 + (y2 - y1)^2)`
- **Circle area**: `A = pi r^2`

## group_theory
- **Group axioms**: `closure, associativity, identity e, inverse a^-1`
- **Subgroup criterion**: `H <= G iff nonempty and a b^-1 in H for all a,b in H`
- **Lagrange's theorem**: `|H| divides |G| for any subgroup H of finite G`
- **Order of an element**: `order of g divides |G|; g^|G| = e`
- **Cauchy's theorem**: `if prime p divides |G| then G has an element of order p`
- **Sylow theorems**: `for |G|=p^n m, Sylow p-subgroups of order p^n exist; number = 1 mod p`
- **Cyclic implies abelian**: `every cyclic group is abelian`
- **Normal subgroup**: `N normal in G iff g N g^-1 = N for all g`
- **Quotient group**: `G/N is a group when N is normal in G`
- **First isomorphism theorem**: `G / ker(phi) is isomorphic to im(phi)`
- **Homomorphism**: `phi(a b) = phi(a) phi(b)`
- **Orbit-stabilizer theorem**: `|orbit of x| * |stabilizer of x| = |G|`

## ring_theory
- **Ring axioms**: `abelian group under +, associative *, distributive`
- **Field axioms**: `commutative ring where every nonzero element has a multiplicative inverse`
- **Ideal**: `I ideal iff subgroup under + and r I subset of I for all r in R`

## series
- **Geometric series**: `sum_{k=0}^inf a r^k = a / (1 - r)`
