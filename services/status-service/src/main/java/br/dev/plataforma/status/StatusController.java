package br.dev.plataforma.status;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** API consumida pela página inicial do frontend. */
@RestController
@RequestMapping("/api")
public class StatusController {

  private final StatusService statusService;

  public StatusController(StatusService statusService) {
    this.statusService = statusService;
  }

  /** Estado atual da plataforma. Sempre 200: o estado vem no corpo, inclusive DOWN. */
  @GetMapping("/status")
  public ResponseEntity<PlatformStatus> status() {
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(statusService.current());
  }
}
