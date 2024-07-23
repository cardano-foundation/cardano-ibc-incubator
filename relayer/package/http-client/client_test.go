package http_client

import (
	"context"
	"github.com/h2non/gock"
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"
)

func TestExecute(t *testing.T) {
	testCases := []struct {
		name       string
		statusCode int
	}{
		{
			name:       "Success",
			statusCode: http.StatusOK,
		},
		{
			name:       "fail",
			statusCode: http.StatusBadRequest,
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			gock.New("https://aggregator.testing-preview.api.mithril.network").
				Get("/aggregator").
				Reply(tc.statusCode).
				JSON(map[string]string{"message": "success"})
			defer gock.Off()

			client := InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
			var response interface{}
			err := client.Execute(context.Background(), "GET", "https://aggregator.testing-preview.api.mithril.network/aggregator", nil, &response)
			if tc.statusCode == http.StatusOK {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}

func TestGetURL(t *testing.T) {
	client := InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
	url := client.GetURL("/artifact/mithril-stake-distributions", nil)

	require.NotEmpty(t, url)
}

func TestGet(t *testing.T) {
	gock.New("https://aggregator.testing-preview.api.mithril.network").
		Get("/aggregator").
		Reply(http.StatusOK).
		JSON(map[string]string{"message": "success"})
	defer gock.Off()

	client := InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
	var response interface{}
	err := client.Get(&response, "/aggregator", nil)
	require.NoError(t, err)
}

func TestPost(t *testing.T) {
	gock.New("https://aggregator.testing-preview.api.mithril.network").
		Post("/aggregator").
		Reply(http.StatusOK).
		JSON(map[string]string{"message": "success"})
	defer gock.Off()
	client := InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
	var response interface{}
	err := client.Post(&response, "/aggregator", nil)
	require.NoError(t, err)
}

func TestGetBody(t *testing.T) {
	data := map[string]string{"message": "success"}
	body, err := GetBody(data)
	require.NoError(t, err)
	require.NotNil(t, body)
}
