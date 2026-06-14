<?php

namespace App\Controller;

use App\Entity\Product;
use App\Message\SendNotificationMessage;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * Routes that exercise every ErrorWatch capability so the dashboard is
 * populated with meaningful data (errors, traces, spans, cache, logs).
 *
 * Hit them via `make example-symfony-trigger` or curl directly.
 */
final class TriggerController extends AbstractController
{
    public function __construct(
        private readonly LoggerInterface $logger,
        private readonly CacheInterface $cache,
        private readonly HttpClientInterface $httpClient,
        private readonly EntityManagerInterface $em,
        private readonly MessageBusInterface $messageBus,
    ) {
    }

    #[Route('/', methods: ['GET'])]
    public function index(): JsonResponse
    {
        return new JsonResponse([
            'project' => 'example-symfony',
            'routes' => [
                'GET /trigger/error',
                'GET /trigger/http-call',
                'GET /trigger/cache',
                'GET /trigger/log',
                'GET /trigger/slow-query',
                'GET /trigger/db-list',
                'GET /trigger/db-n-plus-one',
                'GET /trigger/queue',
            ],
            'consume' => 'bin/console messenger:consume async',
        ]);
    }

    /**
     * Throw an uncaught exception — the SDK captures it with structured
     * frames, a fingerprint and the current trace/span ids.
     */
    #[Route('/trigger/error', methods: ['GET'])]
    public function triggerError(Request $request): never
    {
        $flavour = $request->query->get('flavour', 'runtime');

        throw match ($flavour) {
            'type'    => new \TypeError('Argument #1 $id must be of type int, string given'),
            'logic'   => new \LogicException('inconsistent state in example-symfony'),
            'runtime' => new \RuntimeException('something went wrong in example-symfony'),
            default   => new \RuntimeException(sprintf('unknown flavour "%s"', $flavour)),
        };
    }

    /**
     * Outbound HTTP call — produces an http.client span with
     * `http.host`/`http.url`/`http.method` and a propagated traceparent.
     */
    #[Route('/trigger/http-call', methods: ['GET'])]
    public function triggerHttpCall(): JsonResponse
    {
        $this->logger->info('about to call httpbin');

        $response = $this->httpClient->request('GET', 'https://httpbin.org/get', [
            'headers' => ['X-Example' => 'errorwatch-symfony-example'],
        ]);

        $status = $response->getStatusCode();

        // Observed traceparent shows up in the response payload thanks to httpbin.
        $data = $response->toArray(false);
        $seenTraceparent = $data['headers']['Traceparent'] ?? null;

        return new JsonResponse([
            'ok' => $status === 200,
            'status' => $status,
            'traceparent_seen_by_httpbin' => $seenTraceparent,
        ]);
    }

    /**
     * Cache operations — the first call misses, subsequent calls hit.
     * Generates `cache.get` spans with `cache.hit: bool` + `cache.key`.
     */
    #[Route('/trigger/cache', methods: ['GET'])]
    public function triggerCache(): JsonResponse
    {
        $key = 'example.cache.counter';

        $value = $this->cache->get($key, function (ItemInterface $item) {
            $item->expiresAfter(60);

            return ['generated_at' => microtime(true), 'note' => 'cold cache'];
        });

        return new JsonResponse([
            'key' => $key,
            'value' => $value,
        ]);
    }

    /**
     * Emit a structured log — the handler enriches it with the current
     * trace_id/span_id so the dashboard can correlate it to the trace.
     */
    #[Route('/trigger/log', methods: ['GET'])]
    public function triggerLog(): JsonResponse
    {
        $this->logger->info('example-symfony info log', [
            'source' => 'trigger',
            'ts' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ]);
        $this->logger->warning('example-symfony warning log — soft boundary', [
            'risk' => 'medium',
            'status_code' => 503,
            'http.status_code' => 503,
        ]);

        return new JsonResponse(['logged' => 2]);
    }

    /**
     * Simulate a slow downstream by deliberately stalling — exposes a
     * high p95 in the Latency pressure card.
     */
    #[Route('/trigger/slow-query', methods: ['GET'])]
    public function triggerSlowQuery(): JsonResponse
    {
        usleep((int) (400 * 1000)); // 400ms

        return new JsonResponse(['slept_ms' => 400]);
    }

    /**
     * Load all products — produces a single db.sql.query span with
     * the sanitized SELECT statement in the description.
     */
    #[Route('/trigger/db-list', methods: ['GET'])]
    public function triggerDbList(): JsonResponse
    {
        $products = $this->em->getRepository(Product::class)->findAll();

        return new JsonResponse([
            'count' => count($products),
            'items' => array_map(
                static fn (Product $p) => ['id' => $p->getId(), 'name' => $p->getName()],
                array_slice($products, 0, 5),
            ),
        ]);
    }

    /**
     * Dispatch a message onto the Messenger async transport — produces a
     * `queue.publish` span inside the HTTP request transaction. Consume the
     * queue with `bin/console messenger:consume async` to see the matching
     * `queue.process` transaction land in the dashboard.
     */
    #[Route('/trigger/queue', methods: ['GET'])]
    public function triggerQueue(Request $request): JsonResponse
    {
        $email = (string) $request->query->get('to', 'demo@example.com');

        $this->messageBus->dispatch(new SendNotificationMessage(
            userEmail: $email,
            subject: 'ErrorWatch demo notification',
            body: 'Dispatched at ' . (new \DateTimeImmutable())->format(DATE_ATOM),
        ));

        return new JsonResponse([
            'dispatched' => SendNotificationMessage::class,
            'to' => $email,
            'hint' => 'Run `bin/console messenger:consume async` to process the queue',
        ]);
    }

    /**
     * Issue one SELECT per product id — produces N+1 spans that the
     * SDK QueryAnalyzer flags in the transaction tags.
     */
    #[Route('/trigger/db-n-plus-one', methods: ['GET'])]
    public function triggerDbNPlusOne(): JsonResponse
    {
        $ids = $this->em->createQueryBuilder()
            ->select('p.id')
            ->from(Product::class, 'p')
            ->setMaxResults(10)
            ->getQuery()
            ->getSingleColumnResult();

        $loaded = [];
        foreach ($ids as $id) {
            $loaded[] = $this->em->find(Product::class, $id)?->getName();
        }

        return new JsonResponse(['n' => count($loaded), 'names' => $loaded]);
    }
}
