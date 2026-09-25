package ru.upgrade.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
public class UploadService {

    private static final Set<String> ALLOWED = Set.of(
            "image/jpeg", "image/png", "image/gif", "image/webp",
            "video/mp4", "video/webm", "video/quicktime"
    );

    private final Path root;

    public UploadService(@Value("${upgrade.upload-dir:./data/uploads}") String uploadDir) throws IOException {
        this.root = Path.of(uploadDir).toAbsolutePath().normalize();
        Files.createDirectories(this.root);
    }

    public Path root() {
        return root;
    }

    public StoredFile store(MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) {
            return null;
        }
        String contentType = file.getContentType() == null ? "" : file.getContentType().toLowerCase(Locale.ROOT);
        if (!ALLOWED.contains(contentType)) {
            throw new IllegalArgumentException("Допустимы только изображения (jpg/png/gif/webp) и видео (mp4/webm/mov)");
        }
        return save(file, contentType, null);
    }

    public StoredFile storeHtml(MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Выберите HTML-файл");
        }
        String original = file.getOriginalFilename() == null ? "prototype.html" : file.getOriginalFilename();
        String lower = original.toLowerCase(Locale.ROOT);
        if (!(lower.endsWith(".html") || lower.endsWith(".htm"))) {
            throw new IllegalArgumentException("Нужен файл с расширением .html или .htm");
        }
        String contentType = file.getContentType() == null ? "" : file.getContentType().toLowerCase(Locale.ROOT);
        if (!contentType.isBlank()
                && !contentType.contains("html")
                && !contentType.equals("application/octet-stream")
                && !contentType.equals("text/plain")) {
            throw new IllegalArgumentException("Загрузите HTML-файл прототипа");
        }
        return save(file, contentType.isBlank() ? "text/html" : contentType, ".html");
    }

    private StoredFile save(MultipartFile file, String contentType, String forceExt) throws IOException {
        String original = file.getOriginalFilename() == null ? "file" : file.getOriginalFilename();
        String ext = forceExt;
        if (ext == null) {
            ext = "";
            int dot = original.lastIndexOf('.');
            if (dot >= 0 && dot < original.length() - 1) {
                ext = original.substring(dot).toLowerCase(Locale.ROOT);
            }
        }
        String stored = UUID.randomUUID() + ext;
        Path target = root.resolve(stored);
        Files.copy(file.getInputStream(), target);
        return new StoredFile(stored, original, contentType);
    }

    public record StoredFile(String storedName, String originalName, String contentType) {}
}
