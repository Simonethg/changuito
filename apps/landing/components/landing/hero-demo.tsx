import styles from './landing.module.css';

/**
 * Looping picture of the shopper. CSS only: the message arrives whole,
 * then the search, the prices and the cart. Nothing here is typed, and
 * there is no address bar. Reduced motion skips the loop and paints the
 * last frame (see `.beatHold` outside the no-preference query).
 *
 * Prices are a demonstration of the screen, not a live quote.
 */
const PRODUCTS = [
  { chain: 'Día', name: 'Vacío', price: '$12.890', beat: styles.beatCard1 },
  { chain: 'Jumbo', name: 'Vacío', price: '$18.450', beat: styles.beatCard2 },
  { chain: 'Disco', name: 'Carbón 4 kg', price: '$6.450', beat: styles.beatCard3 },
  { chain: 'Carrefour', name: 'Pan x6', price: '$2.180', beat: styles.beatCard4 },
] as const;

export function HeroDemo() {
  return (
    <figure className={styles.demo} data-testid="landing-hero-demo">
      <figcaption className={styles.srOnly}>
        Demostración automática: entra el pedido «Asado para 12 el sábado», Changuito busca en Jumbo,
        Disco, Carrefour y Día, muestra precios y deja el carrito listo para pagar con USDC o con tarjeta.
      </figcaption>
      <div className={styles.demoWindow} aria-hidden="true">
        <div className={styles.demoTop}>
          <img
            className={styles.demoMark}
            src="/brand/mascot-idle.png"
            alt=""
            width={397}
            height={583}
          />
          <span className={styles.demoName}>Changuito</span>
        </div>
        <div className={styles.demoThread}>
          <p className={`${styles.demoUser} ${styles.beatHold} ${styles.beatUser}`}>Asado para 12 el sábado</p>
          <p className={`${styles.demoStatus} ${styles.beatStatus}`}>
            <span className={styles.demoDot} />
            Buscando en Jumbo, Disco, Carrefour y Día…
          </p>
          <ul className={`${styles.demoGrid} ${styles.beatHold} ${styles.beatGrid}`}>
            {PRODUCTS.map((product) => (
              <li
                key={`${product.chain}-${product.name}`}
                className={`${styles.demoCard} ${styles.beatHold} ${product.beat}`}
              >
                <span className={styles.demoChain}>{product.chain}</span>
                <span className={styles.demoProduct}>{product.name}</span>
                <span className={styles.demoPrice}>{product.price}</span>
              </li>
            ))}
          </ul>
          <section className={`${styles.demoCart} ${styles.beatHold} ${styles.beatCart}`}>
            <header className={styles.demoCartHead}>
              <span className={styles.demoCartTitle}>Tu changuito</span>
              <span className={styles.demoChain}>Día</span>
            </header>
            <ul className={styles.demoLines}>
              <li>
                <span className={styles.demoQty}>1×</span>
                <span>Vacío</span>
                <span className={styles.demoAmount}>$12.890</span>
              </li>
              <li>
                <span className={styles.demoQty}>1×</span>
                <span>Carbón 4 kg</span>
                <span className={styles.demoAmount}>$6.450</span>
              </li>
            </ul>
            <footer className={styles.demoCartFoot}>
              <div className={styles.demoTotal}>
                <span>Total</span>
                <strong>$19.340</strong>
              </div>
              <div className={`${styles.demoActions} ${styles.beatHold} ${styles.beatPay}`}>
                <span className={styles.demoPay}>Pagá con USDC</span>
                <span className={styles.demoPayGhost}>Pagar con tarjeta</span>
              </div>
            </footer>
          </section>
        </div>
        <div className={styles.demoComposer}>
          <div className={styles.demoField}>Contale qué vas a cocinar</div>
          <span className={styles.demoSend}>Enviar</span>
        </div>
      </div>
    </figure>
  );
}
