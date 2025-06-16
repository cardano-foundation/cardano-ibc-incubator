package http_client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Request struct {
	BaseURL          string
	Headers          map[string]string
	HTTPClient       HTTPClient
	HTTPErrorHandler HTTPErrorHandler
}

type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

type HTTPError struct {
	StatusCode int
	URL        url.URL
	Body       []byte
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("Failed request status %d for url: (%s)", e.StatusCode, e.URL.RequestURI())
}

type HTTPErrorHandler func(res *http.Response, uri string) error

type Option func(request *Request) error

//nolint:gochecknoglobals
var defaultErrorHandler = func(res *http.Response, uri string) error {
	return nil
}

func InitClient(baseURL string, errorHandler HTTPErrorHandler, options ...Option) Request {
	if errorHandler == nil {
		errorHandler = defaultErrorHandler
	}

	client := Request{
		Headers: make(map[string]string),
		HTTPClient: &http.Client{
			Timeout: time.Second * 15,
		},
		HTTPErrorHandler: errorHandler,
		BaseURL:          baseURL,
	}

	for _, option := range options {
		err := option(&client)
		if err != nil {
			log.Fatal("Could not initialize http client", err)
		}
	}

	return client
}

func (r *Request) AddHeader(key, value string) {
	r.Headers[key] = value
}

func (r *Request) Get(result interface{}, path string, query url.Values) error {
	uri := r.GetURL(path, query)

	return r.Execute(context.Background(), "GET", uri, nil, result)
}

func (r *Request) Post(result interface{}, path string, body interface{}) error {
	buf, err := GetBody(body)
	if err != nil {
		return err
	}

	uri := r.GetBase(path)

	return r.Execute(context.Background(), "POST", uri, buf, result)
}

func (r *Request) Execute(ctx context.Context, method, url string, body io.Reader, result interface{}) error {
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return fmt.Errorf("failed to make new request: %w", err)
	}

	for key, value := range r.Headers {
		req.Header.Set(key, value)
	}

	b, err := r.execute(ctx, req)
	if err != nil {
		return err
	}

	err = json.Unmarshal(b, result)
	if err != nil {
		return fmt.Errorf("failed to unmarshal json: %w", err)
	}

	return nil
}

func (r *Request) execute(ctx context.Context, req *http.Request) ([]byte, error) {
	c := r.HTTPClient

	res, err := c.Do(req.WithContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("failed to do request: %w", err)
	}

	err = r.HTTPErrorHandler(res, req.URL.String())
	if err != nil {
		return nil, err
	}

	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusBadRequest {
		defer res.Body.Close()
		body, err2 := ioutil.ReadAll(res.Body)
		if err2 != nil {
			return nil, fmt.Errorf("failed to read body: %w", err2)
		}

		return nil, &HTTPError{
			StatusCode: res.StatusCode,
			URL:        *res.Request.URL,
			Body:       body,
		}
	}

	defer res.Body.Close()
	b, err := ioutil.ReadAll(res.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read body: %w", err)
	}

	return b, nil
}

func (r *Request) GetBase(path string) string {
	baseURL := strings.TrimRight(r.BaseURL, "/")
	if path == "" {
		return baseURL
	}

	path = strings.TrimLeft(path, "/")

	return fmt.Sprintf("%s/%s", baseURL, path)
}

func (r *Request) GetURL(path string, query url.Values) string {
	baseURL := r.GetBase(path)
	if query == nil {
		return baseURL
	}

	queryStr := query.Encode()

	return fmt.Sprintf("%s?%s", baseURL, queryStr)
}

func GetBody(body interface{}) (buf io.ReadWriter, err error) {
	if body != nil {
		buf = new(bytes.Buffer)
		err = json.NewEncoder(buf).Encode(body)
	}

	return
}
